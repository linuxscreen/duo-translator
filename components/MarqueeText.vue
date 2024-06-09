<template>
  <div class="marquee" ref="marquee">
	<span :id="'data-'+uuid" ref="marqueeContent">{{ this.text }}
  </span>
  </div>
</template>
<!--:style="{ 'animation-duration': animationDuration + 's' }"-->
<script>
import {v4 as uuidv4} from 'uuid';

export default {
  name: 'MarqueeText',
  props: {
    // 这里可以添加一些自定义属性
    text: {
      type: String,
      default: ''
    },
    width: {
      type: String,
      default: '100%'
    }
  },
  data() {
    return {
      animationDuration: '1', // 默认动画时间
      scopedAttribute: '',
      uuid: ''
    };
  },
  mounted() {
    this.$refs.marquee.style.width= this.width;
    this.uuid = uuidv4();
    const dummyElement = this.$refs.marqueeContent;
    const attributes = dummyElement.getAttributeNames();
    this.scopedAttribute = attributes.find(attr => attr.startsWith('data-v-'));
    // this.calculateAnimationDuration();
    this.addKeyframes()
    // document.documentElement.style.setProperty('--width', this.width);
  },
  methods: {
    addKeyframes() {
      const contentWidth = this.$refs.marqueeContent.offsetWidth; // 获取内容宽度
      const containerWidth = this.$refs.marqueeContent.parentElement.offsetWidth; // 获取容器宽度
      const totalWidth = contentWidth - containerWidth; // 计算总滚动宽度
      const speed = 80; // 每秒移动的像素数
      this.animationDuration = totalWidth / speed; // 计算动画时间
      const styleSheet = document.createElement('style');
      document.head.appendChild(styleSheet);
      // 开始和结束最后停留1s
      let startDelay = 0.5;
      let endDelay = 0.8;
      let totalTime = this.animationDuration + startDelay + endDelay;
      let percent = 100 * this.animationDuration / totalTime;
      let startPercent = 100 * startDelay / totalTime;
      this.animationDuration = totalTime;
      // console.log(percent, totalTime, this.animationDuration)
      // 使用 CSSStyleSheet.insertRule 方法添加 @keyframes
      const keyframes =
          `@keyframes marquee-${this.uuid} {
          0% { transform: translateX(0%); }
          ${startPercent}% { transform: translateX(0%); }
          ${percent+startPercent}% { transform: translateX(min(100cqw - 100%, 0px)); }
          100% { transform: translateX(min(100cqw - 100%, 0px)); }
        }`;
      styleSheet.sheet.insertRule(keyframes, styleSheet.sheet.cssRules.length);

      // 通过 ref 应用动画
      const animation = `
         #data-${this.uuid}:hover  {
            animation: marquee-${this.uuid} ${totalTime}s linear infinite both;
        }
      `;
      // console.log(animation)
      // this.$refs.marqueeContent.style.animation = `marquee-${id} `+ totalTime + 's linear infinite';
      styleSheet.sheet.insertRule(animation, styleSheet.sheet.cssRules.length);
    },
  }
}
</script>

<style scoped>
:root {
  --animation-duration: 1s;
  --width: 100%;
}

/*.marquee {*/
/*  width: 200px;*/
/*  !*overflow: hidden;*!*/
/*  white-space: nowrap;*/
/*  position: relative;*/
/*}*/
/*.marquee:hover {*/
/*  span {*/
/*    animation: marquee 2s linear infinite both;*/
/*  }*/
/*}*/

.marquee {
  display: flex;
  /*justify-content: center;*/
  position: relative;
  overflow: hidden;
  white-space: nowrap;
  width: var(--width);
  /*padding: 2px 4px;*/
  /*background-color: salmon;*/
  /*resize: horizontal;*/
  container-type: inline-size;

}

/*@keyframes marquee {*/
/*  !*to {*!*/
/*  !*  transform: translateX(min(100cqw - 100%, 0px));*!*/
/*  !*}*!*/
/*  0% {*/
/*    transform: translateX(0%);*/
/*  }*/
/*  !*100% {*!*/
/*  !*  transform: translateX(min(100cqw - 100%, 0px));*!*/
/*  !*}*!*/
/*  !*100% {*!*/
/*  !*  transform: translateX(min(100cqw - 100%, 0px));*!*/
/*  !*}*!*/
/*}*/


</style>
