import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
  LayoutAnimation,
  YellowBox,
  Animated,
  FlatList,
  View,
  PanResponder,
  Platform,
  UIManager,
  StatusBar,
} from 'react-native';
import RowItem from './RowItem';
import styles from './SortableFlatListStyles';

// Measure function triggers false positives
YellowBox.ignoreWarnings(['Warning: isMounted(...) is deprecated']);

const initialState = {
  activeRow: -1,
  showHoverComponent: false,
  spacerIndex: -1,
  scroll: false,
  hoverComponent: null,
  extraData: null,
};

// Note using LayoutAnimation.easeInEaseOut() was causing blank spaces to
// show up in list: https://github.com/facebook/react-native/issues/13207
const layoutAnimConfig = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
  },
};

export default class SortableFlatList extends Component {
  static propTypes = {
    horizontal: PropTypes.bool,
    onMoveEnd: PropTypes.func,
    onMoveBegin: PropTypes.func,
    renderItem: PropTypes.func,
    keyExtractor: PropTypes.func,
    scrollPercent: PropTypes.number,
    scrollSpeed: PropTypes.number,
    data: PropTypes.object,
    extraData: PropTypes.object,
    contentContainerStyle: PropTypes.object,
  }
  static defaultProps = {
    scrollPercent: 5,
    scrollSpeed: 5,
    renderItem: null,
    keyExtractor: null,
    onMoveEnd: () => {},
    onMoveBegin: () => {},
    horizontal: false,
    data: {},
    extraData: {},
    contentContainerStyle: {},
  }

  constructor(props) {
    super(props);

    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }

    this.flatList = React.createRef();

    this.panResponder = PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt, gestureState) => {
        const { pageX, pageY } = evt.nativeEvent;
        const { horizontal } = this.props;
        const tappedPixel = horizontal ? pageX : pageY;
        const tappedRow = this.pixels[Math.floor(this.scrollOffset + tappedPixel)];
        const axis = horizontal ? 'x' : 'y';
        if (tappedRow === undefined) return false;

        this.additionalOffset = (tappedPixel + this.scrollOffset) - this.measurements[tappedRow][axis];

        if (this.releaseAnim) {
          return false;
        }

        this.moveAnim.setValue(tappedPixel);
        this.move = tappedPixel;

        // compensate for translucent or hidden StatusBar on android
        if (Platform.OS === 'android' && !horizontal) {
          const isTranslucent = StatusBar._propsStack
            .reduce(((acc, cur) => {
              const val = (cur.translucent === undefined) ? acc : cur.translucent;
              return val;
            }, false));

          const isHidden = StatusBar._propsStack
            .reduce(((acc, cur) => {
              const val = (cur.hidden === null) ? acc : cur.hidden.value;
              return val;
            }, false));

          this.androidStatusBarOffset = (isTranslucent || isHidden) ? StatusBar.currentHeight + 48 : 48;
        }

        this.offset.setValue(((this.additionalOffset + this.containerOffset) - this.androidStatusBarOffset) * -1);

        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { activeRow } = this.state;
        const { horizontal } = this.props;
        const { moveX, moveY } = gestureState;
        const move = horizontal ? moveX : moveY;
        const shouldSet = activeRow > -1;
        this.moveAnim.setValue(move);

        if (shouldSet) {
          // Kick off recursive row animation
          this.animate();
          this.hasMoved = true;
        }

        return shouldSet;
      },
      onPanResponderMove: Animated.event([null, { [props.horizontal ? 'moveX' : 'moveY']: this.moveAnim }], {
        listener: (evt, gestureState) => {
          const { moveX, moveY } = gestureState;
          const { horizontal } = this.props;
          this.move = horizontal ? moveX : moveY;
        },
      }),
      onPanResponderTerminationRequest: ({ nativeEvent }, gestureState) => false,
      onPanResponderRelease: () => {
        const { activeRow, spacerIndex } = this.state;
        const { data, horizontal } = this.props;
        const activeMeasurements = this.measurements[activeRow];
        const spacerMeasurements = this.measurements[spacerIndex];
        const lastElementMeasurements = this.measurements[data.length - 1];
        if (activeRow === -1) return;
        // If user flings row up and lets go in the middle of an animation measurements can error out.
        // Give layout animations some time to complete and animate element into place before calling onMoveEnd

        // Spacers have different positioning depending on whether the spacer row is before or after the active row.
        // This is because the active row animates to height 0, so everything after it shifts upwards, but everything before
        // it shifts downward
        const isAfterActive = spacerIndex > activeRow;
        const isLastElement = spacerIndex >= data.length;
        const spacerElement = isLastElement ? lastElementMeasurements : spacerMeasurements;
        if (!spacerElement) return;
        const {
          x,
          y,
          width,
          height,
        } = spacerElement;
        const size = horizontal ? width : height;
        const offset = horizontal ? x : y;
        const pos = (offset - (this.scrollOffset + this.additionalOffset)) + (isLastElement ? size : 0);
        const activeItemSize = horizontal ? activeMeasurements.width : activeMeasurements.height;

        this.releaseVal = pos - (isAfterActive ? activeItemSize : 0);

        if (this.releaseAnim) {
          this.releaseAnim.stop();
        }

        this.releaseAnim = Animated.spring(this.moveAnim, {
          toValue: this.releaseVal,
          stiffness: 5000,
          damping: 500,
          mass: 3,
          useNativeDriver: true,
        });

        this.releaseAnim.start(this.onReleaseAnimationEnd);
      },
    });
    this.state = initialState;
  }

  componentDidUpdate = (prevProps) => {
    if (prevProps.extraData !== this.props.extraData) {
      this.setState({ extraData: this.props.extraData });
    }
  }

  onReleaseAnimationEnd = () => {
    const { data, onMoveEnd } = this.props;
    const { activeRow, spacerIndex } = this.state;
    const sortedData = this.getSortedList(data, activeRow, spacerIndex);
    const isAfterActive = spacerIndex > activeRow;
    const from = activeRow;
    const to = spacerIndex - (isAfterActive ? 1 : 0);

    this.moveAnim.setValue(this.releaseVal);
    this.spacerIndex = -1;
    this.hasMoved = false;
    this.move = 0;
    this.releaseAnim = null;
    this.setState(initialState, () => {
      if (onMoveEnd) {
        onMoveEnd({
          row: data[activeRow],
          from,
          to,
          data: sortedData,
        });
      }
    });
  }

  getSortedList = (data, activeRow, spacerIndex) => {
    if (activeRow === spacerIndex) return data;

    const sortedData = data.reduce((acc, cur, i, arr) => {
      if (i === activeRow) {
        return acc;
      } else if (i === spacerIndex) {
        return [...acc, arr[activeRow], cur];
      }

      acc.push(cur);
      return acc;
    }, []);

    if (spacerIndex >= data.length) {
      sortedData.push(data[activeRow]);
    }

    return sortedData;
  }

  getSpacerIndex = (move, activeRow) => {
    const { horizontal } = this.props;
    if (activeRow === -1 || !this.measurements[activeRow]) return -1;
    // Find the row that contains the midpoint of the hovering item
    const hoverItemSize = this.measurements[activeRow][horizontal ? 'width' : 'height'];
    const hoverItemMidpoint = (move - (this.additionalOffset + hoverItemSize)) / 2;
    const hoverPoint = Math.floor(hoverItemMidpoint + this.scrollOffset);
    let spacerIndex = this.pixels[hoverPoint];
    if (spacerIndex === undefined) {
      // Fallback in case we can't find index in pixels array
      spacerIndex = this.measurements.findIndex(({
        width,
        height,
        x,
        y,
      }) => {
        const itemOffset = horizontal ? x : y;
        const itemSize = horizontal ? width : height;
        return hoverPoint > itemOffset && hoverPoint < (itemOffset + itemSize);
      });
    }
    // Spacer index differs according to placement. See note in onPanResponderRelease
    return spacerIndex > activeRow ? spacerIndex + 1 : spacerIndex;
  }

  scroll = (scrollAmt, spacerIndex) => {
    if (spacerIndex >= this.props.data.length) {
      return this.flatList.scrollToEnd();
    }

    if (spacerIndex === -1) {
      return () => {};
    }

    const currentScrollOffset = this.scrollOffset;
    const newOffset = currentScrollOffset + scrollAmt;
    const offset = Math.max(0, newOffset);

    return this.flatList.scrollToOffset({ offset, animated: false });
  }

  measureItem = (index) => {
    const { activeRow } = this.state;
    const { horizontal } = this.props;
    // setTimeout required or else dimensions reported as 0
    if (!!this.refs[index]) {
      setTimeout(() => {
        try {
          // Using stashed ref prevents measuring an unmounted componenet, which throws an error
          this.refs[index].measureInWindow(((x, y, width, height) => {
            if ((width || height) && activeRow === -1) {
              const ypos = y + this.scrollOffset;
              const xpos = x + this.scrollOffset;
              const pos = horizontal ? xpos : ypos;
              const size = horizontal ? width : height;
              const rowMeasurements = {
                y: ypos,
                x: xpos,
                width,
                height,
              };
              this.measurements[index] = rowMeasurements;
              for (let i = Math.floor(pos); i < pos + size; i + 1) {
                this.pixels[i] = index;
              }
            }
          }));
        } catch (e) {
          console.log('## measure error -- index: ', index, activeRow, this.refs[index], e);
        }
      }, 100);
    }
  }

  move = (hoverComponent, index) => {
    const { onMoveBegin } = this.props;
    if (this.releaseAnim) {
      this.releaseAnim.stop();
      this.onReleaseAnimationEnd();
      return;
    }
    this.refs.forEach((ref, idx) => this.measureItem(ref, idx));
    this.spacerIndex = index;
    this.setState({
      activeRow: index,
      spacerIndex: index,
      hoverComponent,
    }, () => onMoveBegin && onMoveBegin(index));
  }

  moveEnd = () => {
    if (!this.hasMoved) this.setState(initialState);
  }

  animate = () => {
    const { activeRow } = this.state;
    const {
      scrollPercent,
      data,
      horizontal,
      scrollSpeed,
    } = this.props;
    const scrollRatio = scrollPercent / 100;
    if (activeRow === -1) return;
    const nextSpacerIndex = this.getSpacerIndex(this.move, activeRow);
    if (nextSpacerIndex > -1 && nextSpacerIndex !== this.spacerIndex) {
      LayoutAnimation.configureNext(layoutAnimConfig);
      this.setState({ spacerIndex: nextSpacerIndex });
      this.spacerIndex = nextSpacerIndex;
      if (nextSpacerIndex === data.length) this.flatList.scrollToEnd();
    }

    // Scroll if hovering in top or bottom of container and have set a scroll %
    const isLastItem = (activeRow === data.length - 1) || nextSpacerIndex === data.length;
    const isFirstItem = activeRow === 0;
    if (this.measurements[activeRow]) {
      const rowSize = this.measurements[activeRow][horizontal ? 'width' : 'height'];
      const hoverItemTopPosition = Math.max(0, this.move - (this.additionalOffset + this.containerOffset));
      const hoverItemBottomPosition = Math.min(this.containerSize, hoverItemTopPosition + rowSize);
      const fingerPosition = Math.max(0, this.move - this.containerOffset);
      const shouldScrollUp = !isFirstItem && fingerPosition < (this.containerSize * scrollRatio);
      const shouldScrollDown = !isLastItem && fingerPosition > (this.containerSize * (1 - scrollRatio));

      if (shouldScrollUp) {
        this.scroll(-scrollSpeed, nextSpacerIndex);
      } else if (shouldScrollDown) {
        this.scroll(scrollSpeed, nextSpacerIndex);
      }
    }

    this.requestAnimationFrame(this.animate);
  }

  moveAnim = new Animated.Value(0)
  offset = new Animated.Value(0)
  hoverAnim = Animated.add(this.moveAnim, this.offset)
  spacerIndex = -1
  pixels = []
  measurements = []
  scrollOffset = 0
  containerSize
  containerOffset
  move = 0
  hasMoved = false
  refs = []
  additionalOffset = 0
  androidStatusBarOffset = 0
  releaseVal = null
  releaseAnim = null

  measureContainer = (ref) => {
    if (ref && this.containerOffset === undefined) {
      // setTimeout required or else dimensions reported as 0
      setTimeout(() => {
        const { horizontal } = this.props;
        ref.measure((x, y, width, height, pageX, pageY) => {
          this.containerOffset = horizontal ? pageX : pageY;
          this.containerSize = horizontal ? width : height;
        });
      }, 50);
    }
  }

  keyExtractor = (item, index) => `sortable-flatlist-item-${index}`;

  renderHoverComponent = () => {
    const { hoverComponent } = this.state;
    const { horizontal } = this.props;
    return !!hoverComponent && (
      <Animated.View style={[
        horizontal ? styles.hoverComponentHorizontal : styles.hoverComponentVertical,
        { transform: [horizontal ? { translateX: this.hoverAnim } : { translateY: this.hoverAnim }] }]}
      >
        {hoverComponent}
      </Animated.View>
    );
  }

  renderItem = ({ item, index }) => {
    const { renderItem, data, horizontal } = this.props;
    const { activeRow, spacerIndex } = this.state;
    const isActiveRow = activeRow === index;
    const isSpacerRow = spacerIndex === index;
    const isLastItem = index === data.length - 1;
    const spacerAfterLastItem = spacerIndex >= data.length;
    const activeRowSize = this.measurements[activeRow]
      ? this.measurements[activeRow][horizontal ? 'width' : 'height']
      : 0;
    const endPadding = (isLastItem && spacerAfterLastItem);
    const spacerStyle = { [horizontal ? 'width' : 'height']: activeRowSize };

    return (
      <View style={[styles.fullOpacity, { flexDirection: horizontal ? 'row' : 'column' }]} >
        {isSpacerRow && <View style={spacerStyle} />}
        <RowItem
          horizontal={horizontal}
          index={index}
          isActiveRow={isActiveRow}
          renderItem={renderItem}
          item={item}
          setRef={this.setRef}
          move={this.move}
          moveEnd={this.moveEnd}
          extraData={this.state.extraData}
        />
        {endPadding && <View style={spacerStyle} />}
      </View>
    );
  }

  render() {
    const { horizontal, keyExtractor } = this.props;

    return (
      <View
        onLayout={() => {
          // console.log('layout', e.nativeEvent)
        }}
        ref={this.measureContainer}
        {...this.panResponder.panHandlers}
        style={styles.wrapper} // Setting { opacity: 1 } fixes Android measurement bug: https://github.com/facebook/react-native/issues/18034#issuecomment-368417691
      >
        <FlatList
          {...this.props}
          scrollEnabled={this.state.activeRow === -1}
          ref={this.flatList}
          renderItem={this.renderItem}
          extraData={this.state}
          keyExtractor={keyExtractor || this.keyExtractor}
          onScroll={({ nativeEvent }) => {
            this.scrollOffset = nativeEvent.contentOffset[horizontal ? 'x' : 'y'];
          }}
          scrollEventThrottle={16}
        />
        {this.renderHoverComponent()}
      </View>
    );
  }
}
