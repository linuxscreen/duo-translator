<template>

  <!--  <login-component v-if="isLogin"></login-component>-->
  <div class="profile">
    <div class="frame-94">
      <div class="header">
        <svg
            class="profile2"
            width="375"
            height="121"
            viewBox="0 0 375 121"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
          <path
              d="M0 0H375V106.777C375 106.777 261.269 121.056 186.538 121C112.548 120.944 0 106.777 0 106.777V0Z"
              fill="#EBF0F0"
          />
        </svg>
        <div class="avatar-profile">
          <div class="avatar2">
            <div class="image-div">
              <img class="rectangle-6" :src="headerImg"/>
            </div>
            <div @click="triggerFileInput" class="uploadButton"></div>
            <!-- 隐藏的文件输入元素 -->
            <input type="file" ref="fileInput" @change="uploadFile" style="display: none;"/>
            <div @click="triggerFileInput" class="line-design-edit-line">
              <svg
                  class="group-profile"
                  width="24"
                  height="23"
                  viewBox="0 0 24 23"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path
                    d="M6.4895 15.1692L16.0725 5.65137L14.7364 4.32438L5.15344 13.8423V15.1692H6.4895ZM7.27281 17.0462H3.26367V13.0643L14.0684 2.33297C14.2456 2.15703 14.4859 2.0582 14.7364 2.0582C14.987 2.0582 15.2273 2.15703 15.4045 2.33297L18.0775 4.98787C18.2547 5.16386 18.3542 5.40252 18.3542 5.65137C18.3542 5.90021 18.2547 6.13887 18.0775 6.31486L7.27281 17.0462V17.0462ZM3.26367 18.9231H20.2715V20.8H3.26367V18.9231Z"
                    fill="black"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div class="frame-93">
        <div class="frame-91">
          <div class="username">{{ username }}</div>
        </div>
        <div class="frame-92">
          <div class="email">{{ email }}</div>
        </div>
      </div>
    </div>
    <div class="card-top">
      <!--      Edit profile information-->
      <div class="bar">
        <div class="left">
          <div class="ico-profile-edit">
            <div class="line-business-profile-line">
              <svg
                  class="group2"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path
                    d="M2 4.65967C2.00183 4.39705 2.1069 4.14569 2.29251 3.95989C2.47813 3.77409 2.72938 3.66877 2.992 3.66667H21.008C21.556 3.66667 22 4.11167 22 4.65967V20.6737C21.9982 20.9363 21.8931 21.1877 21.7075 21.3735C21.5219 21.5593 21.2706 21.6646 21.008 21.6667H2.992C2.72881 21.6664 2.4765 21.5617 2.29049 21.3755C2.10448 21.1893 2 20.9369 2 20.6737V4.65967ZM4 5.66667V19.6667H20V5.66667H4ZM6 7.66667H12V13.6667H6V7.66667ZM8 9.66667V11.6667H10V9.66667H8ZM6 15.6667H18V17.6667H6V15.6667ZM14 7.66667H18V9.66667H14V7.66667ZM14 11.6667H18V13.6667H14V11.6667Z"
                    fill="black"
                />
              </svg>
            </div>
          </div>
          <div class="bar-text">
            <div @click="editProfile" class="theme">Edit email</div>
            <el-dialog v-model="dialogEditEmailVisible" title="modify email" width="300">
              <el-form :model="emailForm">
                <el-form-item label="Email" :label-width="60">
                  <div style="display: flex">
                    <el-input v-model="emailForm.email" autocomplete="off" placeholder="email">
                    </el-input>
                    <el-button :disabled="sendCodeBtnDisable" type="primary" style="width: 80px" @click="sendCode">
                      {{ sendCodeText }}
                    </el-button>
                  </div>
                </el-form-item>
                <el-form-item label="code" :label-width="60">
                  <el-input v-model="emailForm.code" placeholder="verification code">
                  </el-input>
                </el-form-item>
              </el-form>
              <template #footer>
                <div class="dialog-footer">
                  <el-button @click="dialogEditEmailVisible = false">Cancel</el-button>
                  <el-button type="primary" @click="confirmEmail">
                    Confirm
                  </el-button>
                </div>
              </template>
            </el-dialog>

          </div>
        </div>
        <div class="right-text"></div>
      </div>
      <!--      Them-->
      <div @click="selectTheme" class="bar">
        <div class="left">
          <svg
              class="ico-profile-theme"
              width="24"
              height="25"
              viewBox="0 0 24 25"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
          >
            <path
                d="M11 2.16667C15.068 2.16667 18.426 5.20267 18.934 9.13167L21.184 12.6707C21.332 12.9037 21.302 13.2507 20.959 13.3987L19 14.2367V17.1667C19 18.2717 18.105 19.1667 17 19.1667H15.001L15 22.1667H6V18.4727C6 17.2927 5.564 16.1757 4.756 15.1677C3.657 13.7977 3 12.0587 3 10.1667C3 5.74867 6.582 2.16667 11 2.16667ZM11 4.16667C7.686 4.16667 5 6.85267 5 10.1667C5 11.5517 5.468 12.8597 6.316 13.9167C7.41 15.2807 8 16.8337 8 18.4727V20.1667H13L13.002 17.1667H17V12.9187L18.55 12.2547L17.007 9.82967L16.95 9.38767C16.566 6.41767 14.024 4.16667 11 4.16667ZM10.47 7.92967L11 8.45967L11.53 7.92967C12.214 7.24567 13.322 7.24567 14.005 7.92967C14.689 8.61267 14.689 9.72067 14.005 10.4037L11 13.4097L7.995 10.4037C7.311 9.72067 7.311 8.61267 7.995 7.92967C8.678 7.24567 9.786 7.24567 10.47 7.92967Z"
                fill="black"
            />
          </svg>
          <div class="bar-text">
            <div class="theme">Theme</div>
          </div>
        </div>
        <div class="right-text">
          <div class="light-mode">Light mode</div>
        </div>
      </div>
      <!--      Language-->
      <div @click="selectLanguage" class="bar">
        <el-select ref="selectLanguageRef" v-model="selectedLanguage" placeholder="Select"
                   style="opacity: 0; position: absolute; z-index: -1;">
          <el-option
              v-for="item in languages"
              :key="item.value"
              :label="item.label"
              :value="item.value"
          />
        </el-select>
        <div class="left">
          <div class="ico-profile-language">
            <div class="line-editor-translate-2">
              <svg
                  class="group3"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path
                    d="M18.5 10.6667L22.9 21.6667H20.745L19.544 18.6667H15.454L14.255 21.6667H12.101L16.5 10.6667H18.5ZM10 2.66667V4.66667H16V6.66667H14.032C13.2606 8.98875 12.0295 11.1317 10.412 12.9677C11.1333 13.6113 11.9157 14.183 12.748 14.6747L11.997 16.5527C10.9225 15.9433 9.9176 15.2187 9 14.3917C7.21358 16.0084 5.09804 17.2189 2.799 17.9397L2.263 16.0107C4.23284 15.3826 6.04802 14.346 7.59 12.9687C6.44869 11.6766 5.49806 10.2279 4.767 8.66667H7.007C7.56435 9.69553 8.23267 10.6603 9 11.5437C10.2501 10.1028 11.2353 8.45198 11.91 6.66767L2 6.66667V4.66667H8V2.66667H10ZM17.5 13.5517L16.253 16.6667H18.745L17.5 13.5517Z"
                    fill="black"
                />
              </svg>
            </div>
          </div>
          <div class="bar-text">
            <div class="theme">Language</div>
          </div>
        </div>
        <div class="right-text">
          <div class="light-mode">{{ langRightText }}</div>
        </div>
      </div>
    </div>
    <div class="card-top">
      <!--      Help-->
      <div @click="help" class="bar">
        <div class="left">
          <div class="ico-profile-help">
            <div class="line-user-contacts-line">
              <svg
                  class="group4"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path
                    d="M19 7.33334H24V9.33334H19V7.33334ZM17 12.3333H24V14.3333H17V12.3333ZM20 17.3333H24V19.3333H20V17.3333ZM2 22.3333C2 20.2116 2.84285 18.1768 4.34315 16.6765C5.84344 15.1762 7.87827 14.3333 10 14.3333C12.1217 14.3333 14.1566 15.1762 15.6569 16.6765C17.1571 18.1768 18 20.2116 18 22.3333H16C16 20.742 15.3679 19.2159 14.2426 18.0907C13.1174 16.9655 11.5913 16.3333 10 16.3333C8.4087 16.3333 6.88258 16.9655 5.75736 18.0907C4.63214 19.2159 4 20.742 4 22.3333H2ZM10 13.3333C6.685 13.3333 4 10.6483 4 7.33334C4 4.01834 6.685 1.33334 10 1.33334C13.315 1.33334 16 4.01834 16 7.33334C16 10.6483 13.315 13.3333 10 13.3333ZM10 11.3333C12.21 11.3333 14 9.54334 14 7.33334C14 5.12334 12.21 3.33334 10 3.33334C7.79 3.33334 6 5.12334 6 7.33334C6 9.54334 7.79 11.3333 10 11.3333Z"
                    fill="black"
                />
              </svg>
            </div>
          </div>
          <div class="bar-text">
            <div class="theme">Help &amp; Support</div>
          </div>
        </div>
        <div class="right-text"></div>
      </div>
      <!--      VIP-->
      <div @click="vip" class="bar">
        <div class="left">
          <svg
              class="ico-profile-vip"
              width="24"
              height="25"
              viewBox="0 0 24 25"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
          >
            <path
                d="M19.8021 2.83327H4.19789L0 11.0662L12 22.8334L24 11.0662L19.8021 2.83327ZM2.49234 10.6694L5.46352 4.84186H18.5363L21.5074 10.6694L12 19.9926L2.49234 10.6694Z"
                fill="#333333"
            />
            <path
                d="M12 14.9711L7.60335 10.6598L6.15491 12.0801L12 17.8119L17.8451 12.0801L16.3966 10.6598L12 14.9711Z"
                fill="#333333"
            />
          </svg>
          <div class="bar-text">
            <div class="theme">Cloud Sync</div>
          </div>
        </div>
        <div class="right-text"></div>
      </div>
      <!--      Privacy-->
      <div @click="privacy" class="bar">
        <el-dialog v-model="privacyVisible" title="隐私政策协议" width="300" >
          <el-scrollbar style="height: 300px">
            <el-space direction="vertical">
            <el-text>span</el-text>
            <el-text tag="p">This is a paragraph.</el-text>
            <el-text tag="b">Bold</el-text>
            <el-text tag="i">Italic</el-text>
            <el-text>
              This is
              <el-text tag="sub" size="small">subscript</el-text>
            </el-text>
            <el-text>
              This is
              <el-text tag="sup" size="small">superscript</el-text>
            </el-text>
            <el-text tag="ins">Inserted</el-text>
            <el-text tag="del">Deleted</el-text>
            <el-text tag="mark">Marked</el-text>
            <el-text>
              This is
              <el-text tag="sup" size="small">superscript</el-text>
            </el-text>
            <el-text tag="ins">Inserted</el-text>
            <el-text tag="del">Deleted</el-text>
            <el-text tag="mark">Marked</el-text>
          </el-space>
          </el-scrollbar>
        </el-dialog>
        <div class="left">
          <div class="ico-profile-policy">
            <div class="line-system-lock-2-line">
              <svg
                  class="group5"
                  width="24"
                  height="25"
                  viewBox="0 0 24 25"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
              >
                <path
                    d="M6 8.33334V7.33334C6 5.74204 6.63214 4.21592 7.75736 3.0907C8.88258 1.96548 10.4087 1.33334 12 1.33334C13.5913 1.33334 15.1174 1.96548 16.2426 3.0907C17.3679 4.21592 18 5.74204 18 7.33334V8.33334H20C20.2652 8.33334 20.5196 8.4387 20.7071 8.62624C20.8946 8.81377 21 9.06813 21 9.33334V21.3333C21 21.5986 20.8946 21.8529 20.7071 22.0405C20.5196 22.228 20.2652 22.3333 20 22.3333H4C3.73478 22.3333 3.48043 22.228 3.29289 22.0405C3.10536 21.8529 3 21.5986 3 21.3333V9.33334C3 9.06813 3.10536 8.81377 3.29289 8.62624C3.48043 8.4387 3.73478 8.33334 4 8.33334H6ZM19 10.3333H5V20.3333H19V10.3333ZM11 16.0653C10.6187 15.8452 10.3207 15.5054 10.1522 15.0987C9.98376 14.6919 9.9542 14.2409 10.0681 13.8157C10.1821 13.3904 10.4332 13.0146 10.7825 12.7466C11.1318 12.4786 11.5597 12.3333 12 12.3333C12.4403 12.3333 12.8682 12.4786 13.2175 12.7466C13.5668 13.0146 13.8179 13.3904 13.9319 13.8157C14.0458 14.2409 14.0162 14.6919 13.8478 15.0987C13.6793 15.5054 13.3813 15.8452 13 16.0653V18.3333H11V16.0653ZM8 8.33334H16V7.33334C16 6.27248 15.5786 5.25506 14.8284 4.50492C14.0783 3.75477 13.0609 3.33334 12 3.33334C10.9391 3.33334 9.92172 3.75477 9.17157 4.50492C8.42143 5.25506 8 6.27248 8 7.33334V8.33334Z"
                    fill="black"
                />
              </svg>
            </div>
          </div>
          <div class="bar-text">
            <div class="theme">Privacy policy</div>
          </div>
        </div>
        <div class="right-text"></div>
      </div>
    </div>
    <div @click="logout" class="logout">
      <div class="rectangle-1570"></div>
      <div class="div">退出登陆</div>
    </div>
  </div>

</template>
<script lang="ts">
import LoginComponent from "@/components/Login.vue";
import {getUserInfo, getUserList, uploadAvatar} from "@/api/user";
import service from "@/utils/request";
import {useUserStore} from "@/utils/user"
const baseApi = import.meta.env.VITE_BASE_API
export default {
  components: {LoginComponent},
  computed: {
    langRightText(): string {
      let lang = this.languages.findLast((v) => v.value == this.selectedLanguage)?.label
      if (lang) {
        return lang
      } else {
        // 这里修改成检测的语言
        return "中文"
      }
    }
  },
  data() {
    return {
      selectedLanguage: 'chinese1',
      sendCodeText: "send code",
      sendCodeBtnDisable: false,
      dialogEditEmailVisible: false,
      emailForm: {
        email: "",
        code: ""
      },
      username: "",
      email: "",
      headerImg: "",
      isLogin: true,
      languages: [
        {
          value: 'chinese',
          label: '中文',
        },
        {
          value: 'english',
          label: 'English',
        }],
      privacyVisible: false
    }
  },
  methods: {
    logout() {
      useUserStore().LoginOut().then(() => {
        this.$router.push({name: 'login'})
      }).finally(() => {
        this.$router.push({name: 'login'})
      })
    },
    sendCode() {
      console.log("sendCode")
      this.sendCodeBtnDisable = true
      // 文字变成60s倒计时
      let count = 59
      this.sendCodeText = "60s"
      let timer = setInterval(() => {
        this.sendCodeText = count + "s"
        count--
        if (count <= 0) {
          clearInterval(timer)
          this.sendCodeBtnDisable = false
          this.sendCodeText = "send code"
        }
      }, 1000)
    },
    confirmEmail() {
      console.log("confirmEmail")
    },
    // 触发文件选择
    triggerFileInput() {
      console.log("triggerFileInput")
      this.$refs.fileInput.click();
    },
    uploadFile(event) {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      uploadAvatar(file).then(res => {
        if (res.code === 0) {
          this.headerImg = baseApi + res.data.file.url;
        }
      });
    },
    async editProfile() {
      this.dialogEditEmailVisible = true
      console.log("editProfile")
      // let resp = await uploadAvatar(file)
    },
    selectTheme() {
      this.$router.push({name: 'Theme'})
    },
    selectLanguage() {
      this.$refs.selectLanguageRef.toggleMenu()
    },
    help() {
      this.$router.push({name: 'Help'})
    },
    vip() {
      this.$router.push({name: 'VIP'})
    },
    privacy() {
      this.privacyVisible = true
    }

  },
  async mounted() {
    // 获取用户信息
    let data = await getUserInfo()
    if (data.code == 0) {
      this.username = data.data.userInfo.userName
      this.email = data.data.userInfo.email
      this.headerImg = baseApi + data.data.userInfo.headerImg
      // this.isLogin = false
    } else {
      this.$router.push({name: 'Login'})
    }
    // let list = await getUserList('')
    // console.log("profile",info)
    // console.log("profile list",list)
  },

};
</script>

<style scoped>
:root {
  --el-input-bg-color: red !important;
  --default-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Ubuntu, "Helvetica Neue", Helvetica, Arial, "PingFang SC",
  "Hiragino Sans GB", "Microsoft Yahei UI", "Microsoft Yahei",
  "Source Han Sans CN", sans-serif;
}

.profile,
.profile * {
  box-sizing: border-box;
}

.profile {
  background: #ffffff;
  padding: 0px 0px 15px 0px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  height: 544px;
  position: relative;
  overflow: hidden;
}

.frame-94 {
  display: flex;
  flex-direction: column;
  gap: 0px;
  align-items: center;
  justify-content: flex-start;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.profile2 {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  align-self: stretch;
  flex-shrink: 0;
  height: auto;
  position: relative;
  overflow: visible;
}

.avatar-profile {
  margin: -66px 0 0 0;
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  position: relative;
}

.avatar2 {
  flex-shrink: 0;
  width: 120px;
  height: 122px;
  position: relative;
}

.image-div {
  width: 94.49%;
  height: 92.31%;
  position: absolute;
  right: 5.51%;
  left: 0%;
  bottom: 7.69%;
  top: 0%;

}

.image-div img {
  border-radius: 50%;
}

.rectangle-6 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  object-fit: cover;
}

.edit-avatar {
  position: absolute;
  inset: 0;
}

.uploadButton {
  background: var(--light-gray-2, #f5f5f5);
  border-radius: 50%;
  border-style: solid;
  border-color: var(--light-gray-0, #ffffff);
  border-width: 5px;
  width: 36.22%;
  height: 35.38%;
  position: absolute;
  right: 0%;
  left: 63.78%;
  bottom: 0%;
  top: 64.62%;
}

.line-design-edit-line {
  width: 18.9%;
  height: 18.46%;
  position: absolute;
  right: 8.66%;
  left: 72.44%;
  bottom: 8.46%;
  top: 73.08%;
  overflow: hidden;
}

.group-profile {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: visible;
}

.frame-93 {
  display: flex;
  flex-direction: column;
  gap: 0px;
  align-items: center;
  justify-content: flex-start;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.frame-91 {
  display: flex;
  flex-direction: row;
  gap: 0px;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.username {
  color: var(--light-gray-11, #000000);
  text-align: center;
  font-family: var(
      --titlepoppins-large-font-family,
      "Poppins-SemiBold",
      sans-serif
  );
  font-size: var(--titlepoppins-large-font-size, 22px);
  line-height: var(--titlepoppins-large-line-height, 28px);
  font-weight: var(--titlepoppins-large-font-weight, 600);
  position: relative;
}

.frame-92 {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  justify-content: flex-start;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.email {
  color: var(--light-gray-11, #000000);
  text-align: center;
  font-family: var(--body-medium-font-family, "Roboto-Regular", sans-serif);
  font-size: var(--body-medium-font-size, 14px);
  line-height: var(--body-medium-line-height, 20px);
  letter-spacing: var(--body-medium-letter-spacing, 0.25px);
  font-weight: var(--body-medium-font-weight, 400);
  position: relative;
  flex: 1;
}

.card-top {
  background: #ffffff;
  border-radius: 8px;
  padding: 15px 0px 15px 0px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  width: 341px;
  height: 121px;
  position: relative;
  box-shadow: 0px 1px 4px 0px rgba(0, 0, 0, 0.25);
}

.bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  width: 309px;
  position: relative;
  cursor: pointer;
}

.left {
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  justify-content: flex-start;
  flex-shrink: 0;
  height: 24px;
  position: relative;
}

.ico-profile-edit {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
}

.line-business-profile-line {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: hidden;
}

.group2 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: visible;
}

.bar-text {
  display: flex;
  flex-direction: row;
  gap: 9px;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.theme {
  color: var(--light-gray-11, #000000);
  text-align: left;
  font-family: var(--body-medium-font-family, "Roboto-Regular", sans-serif);
  font-size: var(--body-medium-font-size, 14px);
  line-height: var(--body-medium-line-height, 20px);
  letter-spacing: var(--body-medium-letter-spacing, 0.25px);
  font-weight: var(--body-medium-font-weight, 400);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.right-text {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
}

.ico-profile-theme {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
  overflow: visible;
}

.light-mode {
  color: var(--light-primary, #1573fe);
  text-align: center;
  font-family: var(--body-medium-font-family, "Roboto-Regular", sans-serif);
  font-size: var(--body-medium-font-size, 14px);
  line-height: var(--body-medium-line-height, 20px);
  letter-spacing: var(--body-medium-letter-spacing, 0.25px);
  font-weight: var(--body-medium-font-weight, 400);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ico-profile-language {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
}

.line-editor-translate-2 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: hidden;
}

.group3 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: visible;
}

.ico-profile-help {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
}

.line-user-contacts-line {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: hidden;
}

.group4 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: visible;
}

.ico-profile-vip {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
  overflow: visible;
}

.ico-profile-policy {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  position: relative;
}

.line-system-lock-2-line {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: hidden;
}

.group5 {
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
  overflow: visible;
}

.logout {
  flex-shrink: 0;
  width: 114px;
  height: 27px;
  position: relative;
}

.rectangle-1570 {
  background: #ff7e7e;
  border-radius: 5px;
  width: 100%;
  height: 100%;
  position: absolute;
  right: 0%;
  left: 0%;
  bottom: 0%;
  top: 0%;
}

.div {
  color: #64748b;
  text-align: center;
  font-family: var(--body-medium-font-family, "Roboto-Regular", sans-serif);
  font-size: var(--body-medium-font-size, 14px);
  line-height: var(--body-medium-line-height, 20px);
  letter-spacing: var(--body-medium-letter-spacing, 0.25px);
  font-weight: var(--body-medium-font-weight, 400);
  position: absolute;
  right: 20%;
  left: 20%;
  width: 60%;
  bottom: 11.11%;
  top: 14.81%;
  height: 74.07%;
}


.el-input-custom ::v-deep(.el-input__wrapper) {
  --el-input-bg-color: #F0EFFF; /* 设置你需要的背景颜色 */
  --el-input-border-radius: 8px; /* 设置你需要的圆角 */
  box-shadow: none;
  height: 50px;
  /*background-color: red !important;*/
  /*.el-input__wrapper {*/
  /*  background-color: red !important;*/
  /*}*/
}

.el-input-custom ::v-deep(.el-input__inner) {
  /*--el-input-text-color: #a7a2ff;*/
  --el-input-placeholder-color: #a7a2ff;
}


.main-container {
  overflow: hidden;
}

.main-container,
.main-container * {
  box-sizing: border-box;
}

input,
select,
textarea,
button {
  outline: 0;
}

.main-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex-wrap: nowrap;
  gap: 2px;
  position: relative;
  width: 375px;
  height: 544px;
  margin: 0 auto;
  padding: 12px 32px 0 32px;
  background: #ffffff;
}

.hint {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 16px;
  position: relative;
  min-width: 0;
  height: 156px;
}

.introduce {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 5px;
  position: relative;
  z-index: 1;
}

.sign-up {
  align-self: stretch;
  flex-shrink: 0;
  flex-basis: auto;
  position: relative;
  height: 39px;
  color: #000000;
  font-family: Poppins, var(--default-font-family);
  font-size: 26px;
  font-weight: 600;
  line-height: 39px;
  text-align: left;
  white-space: nowrap;
  z-index: 2;
}

.powerful {
  align-self: stretch;
  flex-shrink: 0;
  flex-basis: auto;
  position: relative;
  height: 32px;
  color: #000000;
  font-family: Poppins, var(--default-font-family);
  font-size: 21px;
  font-weight: 500;
  line-height: 31.5px;
  text-align: left;
  white-space: nowrap;
  z-index: 3;
}

.register {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-shrink: 0;
  position: relative;
  height: 48px;
  z-index: 4;
}

.no-account-register {
  align-self: stretch;
  flex-shrink: 0;
  flex-basis: auto;
  position: relative;
  height: 21px;
  color: #000000;
  font-family: Poppins, var(--default-font-family);
  font-size: 14px;
  font-weight: 400;
  line-height: 21px;
  text-align: left;
  white-space: nowrap;
  z-index: 5;
}

.login-here {
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
  width: 311px;
  font-family: Poppins, var(--default-font-family);
  font-size: 14px;
  font-weight: 400;
  line-height: 21px;
  text-align: left;
  text-overflow: initial;
  white-space: nowrap;
  z-index: 6;
}

.text-4 {
  position: relative;
  color: #000000;
  font-family: Poppins, var(--default-font-family);
  font-size: 14px;
  font-weight: 400;
  line-height: 21px;
  text-align: left;
}

.text-5 {
  position: relative;
  color: #4d47c3;
  font-family: Poppins, var(--default-font-family);
  font-size: 14px;
  font-weight: 600;
  line-height: 21px;
  text-align: left;
}

.box-4 {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-grow: 1;
  flex-shrink: 0;
  flex-basis: 0;
  position: relative;
  min-width: 0;
  min-height: 0;
  z-index: 7;
}

.Button {
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
  height: 66px;
  cursor: pointer;
  background: transparent;
  border: none;
  z-index: 8;
}

.group {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 9;
  border-radius: 8px;
}

.section-2 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  font-size: 0px;
  z-index: 10;
  border-radius: 8px;
}

.text-6 {
  display: block;
  position: relative;
  height: 23px;
  margin: 21.29px 0 0 21.913px;
  color: #a7a2ff;
  font-family: Poppins, var(--default-font-family);
  font-size: 15px;
  font-weight: 400;
  line-height: 22.5px;
  text-align: left;
  white-space: nowrap;
  z-index: 12;
}

.group-2 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: #efefff;
  z-index: 11;
  border-radius: 8px;
}

.password-input {
  display: flex;
  align-items: center;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 5px;
  position: relative;
  cursor: pointer;
  background: transparent;
  border: none;
  z-index: 13;
}

.frame {
  display: flex;
  align-items: flex-start;
  flex-wrap: nowrap;
  flex-grow: 1;
  flex-shrink: 0;
  flex-basis: 0;
  gap: 10px;
  position: relative;
  z-index: 14;
}

.group {
  flex-grow: 1;
  flex-shrink: 0;
  flex-basis: 0;
  position: relative;
  height: 62px;
  font-size: 0px;
  z-index: 15;
  border-radius: 8px;
}

.password {
  display: block;
  position: relative;
  height: 23px;
  margin: 20px 0 0 25.113px;
  color: #a7a2ff;
  font-family: Poppins, var(--default-font-family);
  font-size: 15px;
  font-weight: 400;
  line-height: 22.5px;
  text-align: left;
  white-space: nowrap;
  z-index: 17;
}

.rectangle {
  position: absolute;
  width: 311px;
  height: 62px;
  top: 0;
  left: 0;
  background: #efefff;
  z-index: 16;
  border-radius: 8px;
}

.invisible {
  flex-shrink: 0;
  position: absolute;
  width: 21px;
  height: 17px;
  top: 25.534px;
  right: 51px;
  z-index: 18;
}

.group-1 {
  position: relative;
  width: 21px;
  height: 14.678px;
  margin: 1.161px 0 0 0;
  z-index: 19;
}

.group-2 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 20;
}

.group-3 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: url(../assets/images/b2e3c426-c17d-42dd-9ca1-d94b055a9597.png) no-repeat center;
  background-size: 100% 100%;
  z-index: 21;
}

.forgot-password {
  align-self: stretch;
  flex-shrink: 0;
  flex-basis: auto;
  position: relative;
  height: 20px;
  color: #b0b0b0;
  font-family: Poppins, var(--default-font-family);
  font-size: 13px;
  font-weight: 400;
  line-height: 19.5px;
  text-align: right;
  white-space: nowrap;
  z-index: 22;
}

.login-button {
  border-radius: 8px;
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
  height: 50px;
  cursor: pointer;
  /*background: transparent;*/
  border: none;
  z-index: 23;
}

.group-4 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  font-size: 0px;
  z-index: 24;
  border-radius: 9px;
}

.login {
  display: block;
  position: relative;
  height: 24px;
  margin: 18px 0 0 133.165px;
  color: #ffffff;
  font-family: Poppins, var(--default-font-family);
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  text-align: left;
  white-space: nowrap;
  z-index: 26;
}

.rectangle-5 {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  background: #4d47c3;
  z-index: 25;
  border-radius: 9px;
  box-shadow: 0 4px 61px 0 rgba(77, 71, 195, 0.4);
}

.continue-with {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  flex-shrink: 0;
  flex-basis: auto;
  position: relative;
  width: 138px;
  height: 24px;
  color: #b4b4b4;
  font-family: Poppins, var(--default-font-family);
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  text-align: left;
  white-space: nowrap;
  z-index: 27;
}

.via {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 10px;
  position: relative;
  padding: 0 0 12px 0;
  z-index: 28;
}

.group-6 {
  flex-shrink: 0;
  position: relative;
  width: 155.992px;
  height: 40.275px;
  z-index: 29;
}

.apple {
  position: absolute;
  width: 25.13%;
  height: 96.15%;
  top: 0;
  left: 37.69%;
  background: url(../assets/images/ac1ddd91-0ef6-4b79-94ed-8f0ed17cba0b.png) no-repeat center;
  background-size: 100% 100%;
  z-index: 31;
  overflow: hidden;
}

.google {
  position: absolute;
  width: 39.194px;
  height: 38.726px;
  top: 0;
  left: 116.798px;
  background: url(../assets/images/74e68d7d-8c42-40a3-8dea-c4d8b630657c.png) no-repeat center;
  background-size: cover;
  z-index: 32;
  overflow: hidden;
}

.wechat {
  position: absolute;
  width: 39.194px;
  height: 38.726px;
  top: 1.549px;
  left: 0;
  background: url(../assets/images/019c8b3e-29d3-4d1a-9169-d2114b5f9bf0.png) no-repeat center;
  background-size: cover;
  z-index: 30;
}

</style>