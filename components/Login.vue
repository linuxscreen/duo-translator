<template>
  <div class="main-container">
    <div class="hint">
      <div class="introduce">
        <span class="sign-up">Sign in to </span
        ><span class="powerful">DuoTranslator is powerful</span>
      </div>
      <div class="register">
        <span class="no-account-register"
        >If you don’t have an account register</span
        >
        <div class="login-here">
          <span class="text-4">You can </span
          ><span class="register-here-text" @click="goToRegister">Register here !</span>
        </div>
      </div>
    </div>
    <div class="box-4">
      <el-form
          style="width: 100%"
          ref="loginForm"
          :model="loginFormData"
          :rules="rules"
          :validate-on-rule-change="false"
          @keyup.enter="submitForm"
      >
        <el-form-item prop="username" style="width: 100%">
          <el-input class="el-input-custom" v-model="loginFormData.username"
                    placeholder="email or user name"></el-input>
        </el-form-item>
        <el-form-item prop="password" style="width: 100%">
          <el-input class="el-input-custom" v-model="loginFormData.password" type="password"
                    placeholder="password" show-password></el-input>
        </el-form-item>
        <div style="display: flex">
          <el-form-item prop="password" style="width: 65%;">
            <el-input class="el-input-custom" v-model="loginFormData.captcha" placeholder="verification code"
                      show-password></el-input>

          </el-form-item>
          <img
              style="width:100px;height: 40px;margin-left: 10px;"
              v-if="picPath"
              class="w-full h-full"
              :src="picPath"
              alt="请输入验证码"
              @click="loginVerify()"
          >
        </div>

        <div>

        </div>
      </el-form>
      <span class="forgot-password"><a>Forgot password ?</a></span>
      <el-button class="login-button" @click="submitForm" color="#4D47C3">login
      </el-button
      >
      <span class="continue-with">or continue with</span>
      <div class="via">
        <div class="group-6">
          <div class="apple">
            <img src="@/public/apple.svg" alt="apple"/>
          </div>
          <div class="google">
            <img src="@/public/google.svg" alt="goole"/>
          </div>
          <div class="wechat">
            <img src="@/public/wechat.svg" alt="wechat"/>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import {reactive, ref} from "vue";
// import {useUserStore} from "@/utils/user";

export default {
  name: "LoginComponent",
  components: {},
  props: {},
  data() {
    // const userStore = useUserStore
    // 验证函数
    const checkUsername = (rule, value, callback) => {
      if (value.length < 5) {
        return callback(new Error('请输入正确的用户名'))
      } else {
        callback()
      }
    }
    const checkPassword = (rule, value, callback) => {
      if (value.length < 8) {
        return callback(new Error('请输入正确的密码'))
      } else {
        callback()
      }
    }
    const loginForm = ref(null)
    const picPath = ref('')
    const loginFormData = reactive({
      username: '',
      password: '',
      captcha: '',
      captchaId: '',
      openCaptcha: false,
    })
    const rules = reactive({
      username: [{validator: checkUsername, trigger: 'blur'}],
      password: [{validator: checkPassword, trigger: 'blur'}],
      captcha: [
        {
          message: '验证码格式不正确',
          trigger: 'blur',
        },
      ],
    })
    return {
      // userStore,
      picPath,
      loginForm,
      loginFormData,
      rules,
    };
  },
  methods: {
    loginVerify() {
      // 获取验证码
      fetch('http://localhost:8888/base/captcha', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }).then((response) => response.json())
          .then((data) => {
            this.picPath = data.data.picPath
            this.loginFormData.captchaId = data.data.captchaId
            this.loginFormData.openCaptcha = data.data.openCaptcha
            this.rules.captcha.push({
              max: data.data.captchaLength,
              min: data.data.captchaLength,
              message: `请输入${data.data.captchaLength}位验证码`,
              trigger: 'blur',
            })
          })
          .catch((error) => {
            console.error('Error:', error)
          })
    },
    goToRegister() {
      this.$router.push("/register");
    },
    submitForm() {
      this.$refs.loginForm.validate((valid) => {
        if (valid) {
          // 登陆
          fetch('http://localhost:8888/base/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(this.loginFormData),
          }).then((response) => response.json())
              .then((data) => {
                if (data.code === 0) {
                  // this.$router.push("/home"); // 跳转到用户中心
                  this.$message({
                    message: '登录成功',
                    type: 'success',
                  })
                  // 登录成功后，获取用户信息,储存token
                  // this.userStore.setToken(data.data.token)
                  // useUserStore.setToken()
                } else {
                  this.$message({
                    message: data.msg,
                    type: 'error',
                  })
                  this.loginVerify()
                }
              })
              .catch((error) => {
                console.error('Error:', error)
              })
        } else {
          return false;
        }
      });
    },
  },
  mounted() {
    this.loginVerify()
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

.el-form-item.is-error ::v-deep(.el-input__wrapper) {
  box-shadow: none !important;
}

.register-here-text {
  color: #4D47C3;
  /*字体加粗*/
  font-weight: 600;
  cursor: pointer;
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