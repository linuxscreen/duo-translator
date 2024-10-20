<template>
  <div class="marquee" ref="marquee">
	<span class="marquee-text" :id="'data-'+uuid" ref="marqueeContent">{{ this.text }}
  </span>
  </div>
</template>
<script>
import {v4 as uuidv4} from 'uuid';

export default {
  name: 'MarqueeText',
  props: {
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
      animationDuration: '1', // default animation time
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
    this.addKeyframes()
  },
  methods: {
    addKeyframes() {
      const contentWidth = this.$refs.marqueeContent.offsetWidth; // get the content width
      const containerWidth = this.$refs.marqueeContent.parentElement.offsetWidth; // get the parent container width
      const totalWidth = contentWidth - containerWidth; // calculate the total roll width
      const speed = 80; // The number of pixels moved per second
      this.animationDuration = totalWidth / speed; // calculate animation time
      const styleSheet = document.createElement('style');
      document.head.appendChild(styleSheet);
      // start and end delay times
      let startDelay = 0.5;
      let endDelay = 0.8;
      let totalTime = this.animationDuration + startDelay + endDelay;
      let percent = 100 * this.animationDuration / totalTime;
      let startPercent = 100 * startDelay / totalTime;
      this.animationDuration = totalTime;
      const keyframes =
          `@keyframes marquee-${this.uuid} {
          0% { transform: translateX(0%); }
          ${startPercent}% { transform: translateX(0%); }
          ${percent+startPercent}% { transform: translateX(min(100cqw - 100%, 0px)); }
          100% { transform: translateX(min(100cqw - 100%, 0px)); }
        }`;
      // insert style
      styleSheet.sheet.insertRule(keyframes, styleSheet.sheet.cssRules.length);
      const animation = `
         #data-${this.uuid}:hover  {
            animation: marquee-${this.uuid} ${totalTime}s linear infinite both;
        }
      `;
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

.marquee-text {
    font-size: 14px;
    font-style: normal;
    font-family: var(--presets-body2-font-family, "Inter-Regular", sans-serif),serif
}

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


</style>
