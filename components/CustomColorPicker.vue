<script lang="ts">
import {ref, defineComponent, nextTick} from 'vue';
import {rgbToHex} from "@/entrypoints/utils";
import {ElMessage} from "element-plus";

export default {
  name: 'CustomColorPicker',
  inheritAttrs: false, // 不自动继承属性，因为我们要手动透传
  props: {
    bgColor: {
      type: String,
      default: '#ffffff' // 默认颜色为白色
    },
    customClass: {
      type: String,
      default: ''
    },
    onChecked: {
      type: Object,
      default: {}
    },
    activePreSelected: {},
    modelValue: {
      type: String,
      required: true,
    },
    selectedIndex: {
      type: Number,
      required: true,
    }
  },
  data() {
    return {
      colorPicked: '',
      // colorPicked: this.modelValue,
      'my-custom-class': true,
      preSelectedIndex: 0,

    };
  },
  setup() {
    const colorPickerComponent = ref(null)
    const callInternalMethod = () => {
      if (colorPickerComponent.value) {
        colorPickerComponent.value.show();
      }
    };
    return {
      colorPickerComponent,
      callInternalMethod,
    };
  },
  watch: {
    modelValue(newValue, oldValue) {
      this.colorPicked = newValue;
      console.log('modelValue', newValue, oldValue)
      let ele = this.$el.querySelector('#colorPickBox');
      ele.setAttribute('data-custom-color', newValue)
      console.log('modelValue ele', ele.getAttribute('data-custom-color'))

    },
    colorPicked(newValue, oldValue) {
      console.log('colorPicked', newValue, oldValue)
    },
    selectedIndex(val,old){
      console.log('selectedIndex inner',val,'old',old)
      const elements = this.$el.querySelectorAll('.color-item');
      // 获取当前选中的色块index
      for (let i = 0; i < elements.length; i++) {
        let ele = elements[i];
        ele.classList.remove('active');
      }
      // 根据value prop（即index）找到对应的色块元素
      const selectedElement = elements[val];
      selectedElement.classList.add('active')
    }
  },
  methods: {
    test(){
      console.log('test',this.modelValue)
    },
    checkedColor(event) {
      // 两种色块不能是同种颜色
      let pickers = document.querySelectorAll(".bg-color-pick-list");
      console.log('checkedColor pickers', pickers)
      for (let i = 0; i < pickers.length; i++) {
        let picker = pickers[i];
        if (picker !== this.$el) {
          let elements = picker.querySelector('#colorPickBox');
          console.log('checkedColor elements', elements)
          let color = elements?.getAttribute('data-custom-color');
          console.log('checkedColor color', color)
          if (event.target.style.color != '' && color == rgbToHex(event.target.style.color).toUpperCase()) {
            ElMessage({
              showClose: true,
              offset: 270,
              message: '背景颜色和字体颜色不能相同！',
              type: 'error',
            })
            return;
          }
        }
      }
      //移出其他的active
      let elements = this.$el.querySelectorAll('.color-item');
      let ele = event.target
      let color = ele.style.color
      let hexColor = this.rgbToHex(color).toUpperCase();
      // ele.classList.add('active');
      this.preSelectedIndex = Array.from(elements).indexOf(ele)
      this.colorPicked = hexColor;
      this.$emit('update:modelValue', hexColor);
      // 获取当前选中的色块index
      for (let i = 0; i < elements.length; i++) {
        if (elements[i] === ele) {
          this.$emit('update:selectedIndex', i);
        }
        // let ele = elements[i];
        // if (ele.classList.contains('active')) {
          // this.$emit('update:selectedIndex', i);
        //   // this.$emit('update:modelValue', i);
        // }
      }
    },
    showColorPicker() {
      this.$emit('update:selectedIndex', 5);
      // this.$emit('update:modelValue', 5);
      this.callInternalMethod();
      // let elements = this.$el.querySelectorAll('.bg-color-pick-list .color-item');

      // let ele = this.$el.querySelector("#colorPickBox")
      // ele?.classList.add('active');
    },
    onColorChange() {
      let pickers = document.querySelectorAll(".bg-color-pick-list");
      for (let i = 0; i < pickers.length; i++) {
        let picker = pickers[i];
        if (picker !== this.$el) {
          let elements = picker.querySelector('#colorPickBox');
          let color = elements?.getAttribute('data-custom-color');
          if (color == this.colorPicked) {
            ElMessage({
              showClose: true,
              offset: 270,
              message: '背景颜色和字体颜色不能相同！',
              type: 'error',
            })
            console.log(this.$el.querySelector(".color-item.active"))
            this.$el.querySelector(".color-item.active").classList.remove("active")
            console.log(this.preSelectedIndex)
            this.$el.querySelector(".color-item:nth-child(" + (this.preSelectedIndex + 1) + ")").classList.add("active")
            return
          }
        }
      }
      // this.$emit('color-changed', this.colorPicked);

    },
    rgbToHex(rgb) {
      // Extract the RGB values
      const result = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
      return result ? "#" +
          ("0" + parseInt(result[1], 10).toString(16)).slice(-2) +
          ("0" + parseInt(result[2], 10).toString(16)).slice(-2) +
          ("0" + parseInt(result[3], 10).toString(16)).slice(-2) : rgb;
    },
  },
  mounted() {
    console.log('custom mounted',this.modelValue)
    // this.$nextTick(() => {
    //   console.log('selectedIndexMm',this.selectedIndex)
    //   // console.log('selectedIndex',val,'old',old)
    //   const elements = this.$el.querySelectorAll('.color-item');
    //   // 根据value prop（即index）找到对应的色块元素
    //   const selectedElement = elements[this.selectedIndex];
    //   selectedElement.classList.add('active');
    //   console.log('selectedElement', selectedElement)
    //
    // });
    // // 如果找到了对应的色块元素，就添加active类
    // if (selectedElement) {
    //   selectedElement.classList.add('active');
    // }
    // let ele = this.$el.querySelector('#colorPickBox')
    // // 获取颜色选择box的位置
    // let top = ele.getBoundingClientRect.top
    // let left = ele.getBoundingClientRect.left
    // // 获取颜色选择器的大小
    // let colorPicker = this.$el.querySelector('.el-color-picker__panel')
    // console.log(colorPicker)
    // let width = colorPicker.offsetWidth
    // let height = colorPicker.offsetHeight
    // console.log(top, left, width, height)
  }
}

</script>

<template>
  <section class="bg-color-pick-list" :class="customClass">
<!--     <span class="color-item" @click="test">-->
<!--          </span>-->
        <span class="color-item" @click="checkedColor($event)">
          </span>
    <span class="color-item" style="color: #df5f47" @click="checkedColor($event)">
          </span><!---->
    <span class="color-item" style="color:#57a0ee;" @click="checkedColor($event)">
          </span><!---->
    <span class="color-item" style="color:#faec63;" @click="checkedColor($event)">
          </span><!---->
    <span class="color-item" style="color:#73b364;" @click="checkedColor($event)">
          </span><!---->
    <span class="color-item" id="colorPickBox" :data-custom-color="colorPicked" @click="showColorPicker()">
  <el-color-picker id="colorPicker" ref="colorPickerComponent" v-bind="$attrs"
                   @change="onColorChange" />
        </span>
  </section>

</template>

<style scoped>
:root {
  --main-bg-color: red;
}

.customClass {
  background-color: red;
}

.bg-color-pick-list {
  width: 132px;
  box-sizing: border-box;
  padding: 1px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  backface-visibility: hidden;
}

.el-color-picker__panel {
  position: absolute;
  top: 165px !important;
}

</style>