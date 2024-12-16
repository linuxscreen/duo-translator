<script lang="ts">
import useI18n from "@/composables/useI18n";
export default {

}
// const currentTab = 'home';
</script>

<template>
  <v-app>
    <v-main>
      <router-view></router-view>
    </v-main>
  </v-app>
</template>

<style scoped>
#app {
  weight: 100%;
  height: 100%;
  background-color: #f0f1f3;
}

.title p {
  cursor: default;
  user-select: none;
}

.tab-home:hover {
  background-color: #F6F6F6;
}

.tab-profile:hover {
  background-color: #F6F6F6;
}

.tab-settings:hover {
  background-color: #F6F6F6;
}

.tab-about:hover {
  background-color: #F6F6F6;
}


.navigation,
.navigation * {
  box-sizing: border-box;
}

.navigation {
  display: flex;
  flex-direction: column;
  gap: 0px;
  align-items: flex-start;
  justify-content: flex-start;
  position: relative;
}

.tab-bar {
  background: rgba(251, 252, 252, 0.7);
  display: flex;
  flex-direction: column;
  gap: 0px;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  width: 375px;
  height: 56px;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(6px);
}

.tabs {
  display: flex;
  flex-direction: row;
  gap: 0px;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.tab-home {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: relative;
}

.icon-view {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
}

.icon {
  width: 24px;
  height: 24px;
  position: absolute;
  left: 0px;
  top: 0px;
  overflow: visible;
}

.title {
  color: var(--text-primary, #0f172a);
  text-align: center;
  font-family: var(--caption-font-family, "DmSans-Regular", sans-serif);
  font-size: var(--caption-font-size, 12px);
  line-height: var(--caption-line-height, 16px);
  font-weight: var(--caption-font-weight, 400);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-profile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: relative;
}

.icon2 {
  width: 24px;
  height: 24px;
  position: absolute;
  left: 0px;
  top: 0px;
  overflow: visible;
}

.title {
  color: var(--text-secondary, #64748b);
  text-align: center;
  font-family: var(--caption-font-family, "DmSans-Regular", sans-serif);
  font-size: var(--caption-font-size, 12px);
  line-height: var(--caption-line-height, 16px);
  font-weight: var(--caption-font-weight, 400);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-settings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: relative;
}

.icon3 {
  width: 24px;
  height: 24px;
  position: absolute;
  left: 0px;
  top: 0px;
  overflow: visible;
}

.tab-about {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  justify-content: center;
  flex: 1;
  position: relative;
}

.icon4 {
  width: 24px;
  height: 24px;
  position: absolute;
  left: 0px;
  top: 0px;
  overflow: visible;
}


</style>
