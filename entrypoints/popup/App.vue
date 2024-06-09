<script lang="ts">
import useI18n from "@/composables/useI18n";
export default {
  setup() {
    const { t } = useI18n();
    return {
      t
    };
  },
  data: () => ({
    currentTab: '',
  }),
  watch: {
    $route(newRoute) {
      this.currentTab = newRoute.path;
    },
    currentTab(val) {
      console.log(val)
    },
  },
  mounted() {
    this.$router.push('/home');
  },
  methods :{
    activeTab(name: string) {
      document.querySelector('.tab-' + this.currentTab.substring(1) + ' svg path')?.setAttribute('fill', '#64748B');
      document.querySelector('.tabs title')?.setAttribute('fill', '#64748B');
      let tab = document.querySelector('.tab-' + name + " svg path")
      // 修改svg的颜色
      tab?.setAttribute('fill', '#0F172A');
      // tab.style.fill = '#0F172A';
      let text = document.querySelector('.tab-' + name + ' .title p') as HTMLElement
      text.style.color = '#0F172A';
      this.$router.push('/' + name);
    }
  },

}
// const currentTab = 'home';
</script>

<template>
  <v-app>
    <v-main>
      <router-view></router-view>
    </v-main>
    <v-bottom-navigation
        v-model="currentTab"
        grow
    >
      <div class="navigation">
        <div class="tab-bar">
          <div class="tabs">
            <div class="tab-home" @click="activeTab('home')">
              <div style="height: 2px"></div>
              <div class="icon-view">
                <svg
                    class="icon"
                    width="25"
                    height="24"
                    viewBox="0 0 25 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                      d="M13.7235 2.75147C13.2549 2.28284 12.4951 2.28284 12.0265 2.75147L3.62647 11.1515C3.15784 11.6201 3.15784 12.3799 3.62647 12.8485C4.09509 13.3172 4.85489 13.3172 5.32352 12.8485L5.67499 12.4971V20.4C5.67499 21.0627 6.21225 21.6 6.87499 21.6H9.27499C9.93774 21.6 10.475 21.0627 10.475 20.4V18C10.475 17.3373 11.0123 16.8 11.675 16.8H14.075C14.7377 16.8 15.275 17.3373 15.275 18V20.4C15.275 21.0627 15.8123 21.6 16.475 21.6H18.875C19.5377 21.6 20.075 21.0627 20.075 20.4V12.4971L20.4265 12.8485C20.8951 13.3172 21.6549 13.3172 22.1235 12.8485C22.5922 12.3799 22.5922 11.6201 22.1235 11.1515L13.7235 2.75147Z"
                      fill="#0F172A"
                  />
                </svg>
              </div>
              <div class="title"><p>{{t('Home')}}</p></div>
              <div style="height: 2px"></div>
            </div>
            <div class="tab-profile" @click="activeTab('profile')">
              <div style="height: 2px"></div>
              <div class="icon-view">
                <svg id="ico-home"
                     class="icon2"
                     width="25"
                     height="24"
                     viewBox="0 0 25 24"
                     fill="none"
                     xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                      fill-rule="evenodd"
                      clip-rule="evenodd"
                      d="M22.225 12C22.225 17.3019 17.9269 21.6 12.625 21.6C7.32306 21.6 3.02499 17.3019 3.02499 12C3.02499 6.69806 7.32306 2.39999 12.625 2.39999C17.9269 2.39999 22.225 6.69806 22.225 12ZM15.025 8.39999C15.025 9.72548 13.9505 10.8 12.625 10.8C11.2995 10.8 10.225 9.72548 10.225 8.39999C10.225 7.07451 11.2995 5.99999 12.625 5.99999C13.9505 5.99999 15.025 7.07451 15.025 8.39999ZM12.6249 13.2C10.2039 13.2 8.11773 14.6339 7.16948 16.6989C8.48983 18.2304 10.4442 19.2 12.625 19.2C14.8057 19.2 16.76 18.2305 18.0804 16.699C17.1322 14.634 15.046 13.2 12.6249 13.2Z"
                      fill="#64748B"
                  />
                </svg>
              </div>
              <div class="title"><p>{{ t('Profile') }}</p></div>
              <div style="height: 2px"></div>
            </div>
            <div class="tab-settings" @click="activeTab('settings')">
              <div style="height: 2px"></div>
              <div class="icon-view">
                <svg
                    class="icon3"
                    width="25"
                    height="24"
                    viewBox="0 0 25 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                      d="M3.69835 16.4C4.36007 17.5485 5.82756 17.9431 6.97603 17.2813L6.97836 17.28L7.33435 17.0744C8.00635 17.6493 8.77877 18.0952 9.61273 18.3896V18.8C9.61273 20.1255 10.6873 21.2 12.0127 21.2C13.3382 21.2 14.4127 20.1255 14.4127 18.8V18.3896C15.2468 18.0947 16.0193 17.6483 16.6911 17.0728L17.0487 17.2792C18.1975 17.9419 19.666 17.548 20.3287 16.3992C20.9915 15.2504 20.5975 13.7819 19.4487 13.1192L19.0935 12.9144C19.2534 12.0443 19.2534 11.1524 19.0935 10.2824L19.4487 10.0776C20.5975 9.41484 20.9915 7.94634 20.3287 6.79756C19.666 5.64883 18.1975 5.25481 17.0487 5.91755L16.6927 6.12316C16.0201 5.54893 15.2471 5.10388 14.4127 4.8104V4.4C14.4127 3.07452 13.3382 2 12.0127 2C10.6873 2 9.61273 3.07452 9.61273 4.4V4.8104C8.77866 5.10526 8.0062 5.55166 7.33435 6.12721L6.97675 5.92003C5.82797 5.25725 4.35947 5.65126 3.69673 6.8C3.034 7.94874 3.42797 9.41727 4.57675 10.08L4.93195 10.2848C4.77205 11.1548 4.77205 12.0467 4.93195 12.9168L4.57675 13.1216C3.43116 13.7861 3.03846 15.2518 3.69835 16.4ZM12.0127 8.40001C13.78 8.40001 15.2127 9.8327 15.2127 11.6C15.2127 13.3673 13.78 14.8 12.0127 14.8C10.2454 14.8 8.81275 13.3673 8.81275 11.6C8.81275 9.8327 10.2454 8.40001 12.0127 8.40001Z"
                      fill="#64748B"
                  />
                </svg>
              </div>
              <div class="title"><p>{{ t('Settings') }}</p></div>
              <div style="height: 2px"></div>
            </div>
            <div class="tab-about" @click="activeTab('about')">
              <div style="height: 2px"></div>
              <div class="icon-view">
                <svg
                    class="icon4"
                    width="25"
                    height="24"
                    viewBox="0 0 25 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                      d="M11.725 21.2C17.0269 21.2 21.325 16.9019 21.325 11.6C21.325 6.29806 17.0269 2 11.725 2C6.42306 2 2.125 6.29806 2.125 11.6C2.13074 16.8996 6.42543 21.1943 11.725 21.2ZM10.925 6.8C10.925 6.35818 11.2832 6.00001 11.725 6.00001C12.1668 6.00001 12.525 6.35818 12.525 6.8V13.2C12.525 13.6418 12.1668 14 11.725 14C11.2832 14 10.925 13.6418 10.925 13.2V6.8ZM11.725 16.4C12.1668 16.4 12.525 16.7582 12.525 17.2C12.525 17.6418 12.1668 18 11.725 18C11.2832 18 10.925 17.6418 10.925 17.2C10.925 16.7582 11.2832 16.4 11.725 16.4Z"
                      fill="#64748B"
                  />
                </svg>
              </div>
              <div class="title"><p>{{ t('About') }}</p></div>
              <div style="height: 2px"></div>
            </div>
          </div>
        </div>
      </div>


    </v-bottom-navigation>
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
