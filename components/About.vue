<template>
  <h1>hee</h1>
  <!--  <el-switch-->
  <!--      v-model="value"-->
  <!--      size="large"-->
  <!--      active-text="Open"-->
  <!--      inactive-text="Close"-->
  <!--      @change="change"-->
  <!--  />-->
  <!--  <my-switch-->
  <!--      v-model="value"-->
  <!--      size="small"-->
  <!--      swidth="44px"-->
  <!--      active-text="Open"-->
  <!--      inactive-text="Close"-->
  <!--  ></my-switch>-->
  <!--  <div id="container">-->
  <!--&lt;!&ndash;    <div id="div">&ndash;&gt;-->
  <!--      <button id="button1">自适应</button>-->
  <!--      <p id="p">网站测试变得越来越复杂。仅仅在几个浏览器中检查功能的日子一去不复返了。你的最新杰-->
  <!--        作必须在一系列具有不同操作系统，屏幕分辨率和功能的移动、平板和桌面设备上进行严格-->
  <!--        评估。在极端情况下，它可能需要与原始开发一样长的时间。</p>-->
  <!--      <button id="button2">右边</button>-->
  <!--&lt;!&ndash;    </div>&ndash;&gt;-->
  <!--  </div>-->

  <!--  <div class="container">-->
  <!--    <button class="side-button left">左侧按钮</button>-->
  <!--    <button class="side-button right">右侧按钮</button>-->
  <!--    <div class="text-content">这里是自适应的文本内容，会根据容器大小自动调整。</div>-->
  <!--  </div>-->

  <!--  <div id="grid">-->
  <!--    <div id="grid-item1">1</div>-->
  <!--    <div id="grid-item2">2</div>-->
  <!--    <div id="grid-item3">3</div>-->
  <!--    <div id="grid-item4">4</div>-->
  <!--    <div id="grid-item5">5</div>-->
  <!--    <div id="grid-item6">6</div>-->
  <!--    <div id="grid-item7">7</div>-->
  <!--    <div id="grid-item8">8</div>-->
  <!--    <div id="grid-item9">9</div>-->
  <!--  </div>-->

  <marquee-text text="sff sfffsff sfffsff sfffsff sfffsff sfffsff sfffsff sfffsff sfffsff sfff"
                width="120px"></marquee-text>
</template>

<script lang="ts">
import CustomSwitch from "@/components/CustomSwitch.vue";
import CustomColorPicker from "@/components/CustomColorPicker.vue";
import MarqueeText from "@/components/MarqueeText.vue";
// import { ref } from 'vue'
//
// const value = ref(true)
export default {
  components: {MarqueeText, CustomColorPicker, CustomSwitch},

  async mounted() {
    console.log('mounted')
    console.log(this.usernameToDbName("zheng"))
  },
  methods: {
    usernameToDbName(name) {
      return 'userdb-' + Buffer.from(name).toString('hex');
    },
    change(value: boolean) {
      console.log(value)
    }
  }
}

</script>
<style scoped>
#grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  /*grid-auto-rows: 30px;*/
  /*grid-template-columns: repeat(3, 1fr);*/
  /*grid-template-rows: repeat(3, 1fr);*/
  gap: 10px;
  width: 100%;
  height: 300px;
}

#grid div {
  width: 150px;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  padding: 10px;
  text-align: center;
}

.container {
  position: relative; /* 设定相对定位作为子元素浮动的参考 */
  overflow: hidden; /* 清除浮动影响 */
  padding: 0 20px; /* 确保容器两端留有空间 */
}

.side-button {
  float: left; /* 左侧按钮向左浮动 */
  margin-right: 10px; /* 与文本内容保持一定距离 */
}

.side-button.right {
  float: right; /* 右侧按钮向右浮动 */
  margin-left: 10px; /* 与文本内容保持一定距离 */
}

.text-content {
  width: 100px;
  height: 40px;
  margin: 0 auto; /* 确保文本内容在中间 */
  overflow: auto; /* 防止文本内容被浮动元素覆盖 */
}

#container {
  display: flex;
  justify-content: space-around;
  align-items: flex-start;
}

#p {
  width: 70%;
  /*width: 200px;*/
}

#button1 {
  width: 15%;
  /*margin-left: 20px;*/
  /*position: absolute;*/
  /*left: 20px;*/
  background-color: coral;
  /*width: 200px;*/
  height: 50px;
}

#button2 {
  width: 15%;
  /*position: absolute;*/
  /*!*margin-right: 20px;*!*/
  /*right: 20px;*/
  /*padding: 30px;*/
  background-color: red;
  /*width: 200px;*/
  height: 50px;
}

#div {
  width: 100%;
  height: 50px;
  background-color: aqua;
}
</style>