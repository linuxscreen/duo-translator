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
  <v-btn @click="translateWebSite">translate this website</v-btn>

</template>

<style scoped>

</style>