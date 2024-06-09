<script lang="ts" setup>
import { ref } from 'vue';
import {browser, Tabs} from "wxt/browser";
import {log} from "node:util";

defineProps({
  msg: String,
});

const count = ref(0);
function change(){
  storage.setItem('local:installDate',Date.now())
  console.log("clicked")
}

async function translateText(text, targetLanguage) {
  const apiKey = 'AIzaSyC_zDStMeRgutILdJuL_4xyQpEwawBrKw4';  // 替换为你的 API 密钥
  const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: text,
      target: targetLanguage
    })
  });

  const data = await response.json();
  console.log(data.data.translations[0].translatedText);
  return data.data.translations[0].translatedText;
}

function getTranslateText(text :string)  {
  // 调用谷歌翻译API,获取翻译结果
  let url = 'https://translate.google.cn/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + text;
  fetch(url).then((res)=>{
    return res.json()
  }).then((res)=>{
    return res.toString()
  })
}

function sendToTranslate(){
  console.log("trans")
  // browser.storage.local.get('installDate').then((res)=>{
  //   console.log(res)
  // })
  let selected = window.getSelection()?.toString();
  // send to background process
  browser.runtime.sendMessage({
    action: 'translate',
    text: selected,
    lang: 'en'
  }).then((response)=>{
    // console.log(response.text)
    let res = translateText(response.text,"zh")
    console.log(res)
  })

  // browser.scripting.executeScript({
  //   func: text,
  //   target: {tabId: 11}
  // })
  // browser.tabs.executeScript({
  //   code: `window.getSelection().toString();`
  // }).then(selection => {
  //   console.log(selection)
  // });
  // browser.tabs.executeScript({code:`window.getSelection()?.toString()`}).then((result)=>{
  //   console.log(result)
  // })
}
function test(){
    
}

</script>
<template>
  <h1>{{ msg }}</h1>

  <div class="card">
    <button type="button" @click="change()">count is {{ count }}</button>
    <button type="button" @click="sendToTranslate">translate selected</button>
    <p>
      Edit
      <code>components/HelloWorld.vue</code> to test HMR
    </p>
  </div>

  <p>
    Install
    <a href="https://github.com/vuejs/language-tools" target="_blank">Volar</a>
    in your IDE for a better DX
  </p>
  <p class="read-the-docs">Click on the WXT and Vue logos to learn more</p>
</template>

<style scoped>
.read-the-docs {
  color: #888;
}
</style>
