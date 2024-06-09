<script lang="ts">

export default {
  methods: {
    translateWebSite() {
      console.log('translateWebSite')
    },
    showPopup() {
      this.$emit('showPopup');
    }
  },
}

</script>

<template>
  <v-btn @click="translateWebSite">翻译此网站</v-btn>

</template>

<style scoped>

</style>