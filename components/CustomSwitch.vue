<template>
  <el-switch v-bind="$attrs" :class="customClass">
    <!-- 使用插槽传递内容 -->
<!--    <template v-for="(_, slot) in $slots" v-slot:[slot]="slotData">-->
<!--      <slot :name="slot" v-bind="slotData"></slot>-->
<!--    </template>-->
  </el-switch>
</template>

<script>
export default {
  name: 'CustomSwitch',
  inheritAttrs: false, // 不自动继承属性，因为我们要手动透传
  props: {
    // 这里可以添加一些自定义属性
    swidth: {
      type: String,
      default: '10'
    },
    bgColor: {
      type: String,
      default: '#ffffff' // 默认颜色为白色
    }
  },
  data() {
    return {
      // 这里可以添加一些自定义数据

    };
  },
  computed: {
    customClass() {
      // 这里可以添加一些自定义逻辑来决定类名
      return {
        'my-custom-class': true
      };
    }
  },
  mounted() {
    //获取el-switch__action的宽度
    console.log(this.swidth)
    document.documentElement.style.setProperty('--main-bg-color', this.bgColor); // 使用 bgColor prop 设置背景颜色
    let width = document.querySelector(".my-custom-class .el-switch__action")?.offsetWidth
    // document.documentElement.style.setProperty('--main-bg-color', 'green');
    document.documentElement.style.setProperty('--el-switch-action-width', width+'px');
    document.documentElement.style.setProperty('--swidth', this.swidth+'px');
  }
};
</script>

<style scoped>
.my-custom-class {
  /* 自定义样式 */
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
