import PropTypes from 'prop-types';
import React from 'react';
import { View } from 'react-native';


export default class RowItem extends React.PureComponent {
  static propTypes = {
    horizontal: PropTypes.bool.isRequired,
    move: PropTypes.func,
    moveEnd: PropTypes.func,
    renderItem: PropTypes.func,
    item: PropTypes.object,
    index: PropTypes.number.isRequired,
    isActiveRow: PropTypes.bool,
    setRef: PropTypes.func.isRequired,
  };

  static defaultProps = {
    move: () => {},
    moveEnd: () => {},
    renderItem: () => {},
    item: {},
    isActiveRow: false,
  };

  move = () => {
    const {
      move,
      moveEnd,
      renderItem,
      item,
      index,
    } = this.props;
    const hoverComponent = renderItem({
      isActive: true,
      item,
      index,
      move: () => null,
      moveEnd,
    });
    move(hoverComponent, index);
  }

  render() {
    const {
      moveEnd,
      isActiveRow,
      horizontal,
      renderItem,
      item,
      index,
    } = this.props;
    const component = renderItem({
      isActive: false,
      item,
      index,
      move: this.move,
      moveEnd,
    });
    const flexDirection = horizontal ? 'row' : 'column';
    // Rendering the final row requires padding to be applied at the bottom
    return (
      <View
        ref={this.props.setRef(index)}
        collapsable={false}
        style={{ opacity: 1, flexDirection }}
      >
        <View
          style={[
            horizontal
              ? { width: isActiveRow ? 1 : undefined }
              : { height: isActiveRow ? 1 : undefined },
            { opacity: isActiveRow ? 0 : 1, overflow: 'hidden' },
          ]}
        >
          {component}
        </View>
      </View>
    );
  }
}
