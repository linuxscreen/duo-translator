import { login, getUserInfo, setSelfInfo } from '@/api/user'
import { jsonInBlacklist } from '@/api/jwt'
import { ElLoading, ElMessage } from 'element-plus'
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
// import { useRouterStore } from './router'
// import cookie from 'js-cookie'

export const useUserStore = defineStore('user', () => {
    const loadingInstance = ref(null)

    const userInfo = ref({
        uuid: '',
        nickName: '',
        headerImg: '',
        authority: {},
        sideMode: 'dark',
        baseColor: '#fff'
    })
    // localStorage.getItem("token")
    const token = ref(localStorage.getItem('token') || '')
    const setUserInfo = (val) => {
        userInfo.value = val
    }

    const setToken = (val) => {
        token.value = val
    }

    const NeedInit = () => {
        // token.value = ''
        // window.localStorage.removeItem('token')
        // router.push({ name: 'Init', replace: true })
    }

    const ResetUserInfo = (value = {}) => {
        userInfo.value = {
            ...userInfo.value,
            ...value
        }
    }
    /* 获取用户信息*/
    const GetUserInfo = async() => {
        const res = await getUserInfo()
        if (res.code === 0) {
            setUserInfo(res.data.userInfo)
        }
        return res
    }
    /* 登出*/
    const LoginOut = async() => {
        const res = await jsonInBlacklist()
        if (res.code === 0) {
            await ClearStorage()
            // router.push({ name: 'Login', replace: true })
            // window.location.reload()
        }
    }
    /* 清理数据 */
    const ClearStorage = async() => {
        token.value = ''
        sessionStorage.clear()
        localStorage.removeItem('token')
        // cookie.remove('x-token')
    }


    watch(() => token.value, () => {
        localStorage.setItem('token', token.value)
    })

    return {
        userInfo,
        token,
        NeedInit,
        ResetUserInfo,
        GetUserInfo,
        LoginOut,
        setToken,
        loadingInstance,
        ClearStorage
    }
})
