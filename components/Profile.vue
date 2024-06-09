<template>
  <div class="main-container">
    <div class="hint">
      <div class="introduce">
        <span class="sign-in-to">Sign in to </span
        ><span class="powerful">DuoTranslator is powerful</span>
      </div>
      <div class="register">
        <span class="no-account-register"
        >If you don’t have an account register</span
        >
        <div class="register-here">
          <span class="text-4">You can </span
          ><span class="text-5">Register here !</span>
        </div>
      </div>
    </div>
    <div class="box-4">
      <button class="Button">
        <div class="group">
          <div class="section-2">
            <span class="text-6">Enter email or user name</span>
            <div class="group-2"></div>
          </div>
        </div></button
      ><button class="password-input">
      <div class="frame">
        <div class="group">
          <span class="password">Password</span>
          <div class="rectangle"></div>
        </div>
        <div class="invisible">
          <div class="group-1">
            <div class="group-2"><div class="group-3"></div></div>
          </div>
        </div>
      </div></button
    ><span class="forgot-password">Forgor password ?</span
    ><button class="login-button">
      <div class="group-4">
        <span class="login">Login</span>
        <div class="rectangle-5"></div>
      </div></button
    ><span class="continue-with">or continue with</span>
      <div class="via">
        <div class="group-6">
          <div class="apple"></div>
          <div class="google"></div>
          <div class="facebook"></div>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
export default {
  name: "Login1Mobile",
  components: {},
  props: {},
  data() {
  },
};
</script>

<style scoped>
:root {
  --default-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  Ubuntu, "Helvetica Neue", Helvetica, Arial, "PingFang SC",
  "Hiragino Sans GB", "Microsoft Yahei UI", "Microsoft Yahei",
  "Source Han Sans CN", sans-serif;
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
.sign-in-to {
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
.register-here {
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
  background: url(../assets/images/b2e3c426-c17d-42dd-9ca1-d94b055a9597.png)
  no-repeat center;
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
  align-self: stretch;
  flex-shrink: 0;
  position: relative;
  height: 59px;
  cursor: pointer;
  background: transparent;
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
  background: url(../assets/images/ac1ddd91-0ef6-4b79-94ed-8f0ed17cba0b.png)
  no-repeat center;
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
  background: url(../assets/images/74e68d7d-8c42-40a3-8dea-c4d8b630657c.png)
  no-repeat center;
  background-size: cover;
  z-index: 32;
  overflow: hidden;
}
.facebook {
  position: absolute;
  width: 39.194px;
  height: 38.726px;
  top: 1.549px;
  left: 0;
  background: url(../assets/images/019c8b3e-29d3-4d1a-9169-d2114b5f9bf0.png)
  no-repeat center;
  background-size: cover;
  z-index: 30;
}

</style>