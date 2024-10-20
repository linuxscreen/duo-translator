<template>
  <el-switch v-bind="$attrs" :class="customClass">
  </el-switch>
</template>

<script>
export default {
  name: 'CustomSwitch',
  inheritAttrs: false, // Properties are not automatically inherited because we have to manually transparently transmit them
  props: {
    // custom attributes
    swidth: {
      type: String,
      default: '10'
    },
    bgColor: {
      type: String,
      default: '#ffffff' // default color
    }
  },
  data() {
    return {

    };
  },
  computed: {
    customClass() {
      // Here you can add some custom logic to decide on the class name
      return {
        'my-custom-class': true
      };
    }
  },
  mounted() {
    document.documentElement.style.setProperty('--main-bg-color', this.bgColor); // use bgColor prop to set background color
    let width = document.querySelector(".my-custom-class .el-switch__action")?.offsetWidth  // get the width of el-switch__action
    document.documentElement.style.setProperty('--el-switch-action-width', width+'px');
    document.documentElement.style.setProperty('--swidth', this.swidth+'px');
  }
};
</script>

<style scoped>
.my-custom-class {
  /* custom styles */
}
</style>
<style>
:root{
  --swidth: 100%;
  --main-bg-color: #f0f1f3;
  --el-switch-action-width: 16px;
  --element-toggle-button-background-color: #f0f1f3;
}
.my-custom-class .el-switch__label *{
  font-size: 16px !important;
}
.my-custom-class .el-switch__label--left {
  margin-right: 30px;
}

.my-custom-class .el-switch__label--right {
  margin-left: 30px;
}

.my-custom-class.is-checked .el-switch__core{
  /*background-color: var(--component-fill-component-fill-dark-soft, #f0f1f3) !important;*/
  background-color: var(--main-bg-color) !important;
  border-color: var(--component-fill-component-fill-dark-soft, #f0f1f3) !important;

}

.my-custom-class .el-switch__core .el-switch__action{
  border-radius: var(--radius-radius-infinity, 9999px);
  box-shadow: var(
      --shadow-background-xsm-box-shadow,
      0px 2px 2px 2px rgba(0, 0, 0, 0.16)
  );
  position: inherit;
  left: 0;
}

.my-custom-class.is-checked .el-switch__core .el-switch__action{
  left: calc(100% - var(--el-switch-action-width)) !important;
  background: var(--component-fill-component-fill-positive, #23c965);
}


.my-custom-class .el-switch__core {
  border-radius: var(--radius-radius-infinity, 9999px) !important;
  background: var(--main-bg-color, #f0f1f3);
  border-width: 0;
  padding: 3px;
  height: 100% !important;
  width: var(--swidth);
}

</style>
