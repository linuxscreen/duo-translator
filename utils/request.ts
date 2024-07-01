import axios from 'axios' // 引入axios
import { ElMessage, ElMessageBox } from 'element-plus'
// import { useUserStore } from '@/pinia/modules/user'
import { ElLoading } from 'element-plus'
import router from "@/router";
// export default defineUnlistedScript(
//     () => {
//     }
// )
const service = axios.create({
    baseURL: import.meta.env.VITE_BASE_API,
    timeout: 99999
})

let activeAxios = 0
let timer
let loadingInstance
// http request 拦截器

// http response 拦截器
service.interceptors.response.use(
    response => {
        const userStore = useUserStore()
        if (response.headers['new-token']) {
            userStore.setToken(response.headers['new-token'])
        }
        if (response.data.code === 0 || response.headers.success === 'true') {
            if (response.headers.msg) {
                response.data.msg = decodeURI(response.headers.msg)
            }
            return response.data
        } else {
            ElMessage({
                showClose: true,
                message: response.data.msg || decodeURI(response.headers.msg),
                type: 'error'
            })
            return response.data.msg ? response.data : response
        }
    },
    error => {

        if (!error.response) {
            ElMessageBox.confirm(`
        <p>检测到请求错误</p>
        <p>${error}</p>
        `, '请求报错', {
                dangerouslyUseHTMLString: true,
                distinguishCancelAndClose: true,
                confirmButtonText: '稍后重试',
                cancelButtonText: '取消'
            })
            return
        }

        switch (error.response.status) {
            case 500:
                ElMessageBox.confirm(`
        <p>检测到接口错误${error}</p>
        <p>错误码<span style="color:red"> 500 </span>：此类错误内容常见于后台panic，请先查看后台日志，如果影响您正常使用可强制登出清理缓存</p>
        `, '接口报错', {
                    dangerouslyUseHTMLString: true,
                    distinguishCancelAndClose: true,
                    confirmButtonText: '清理缓存',
                    cancelButtonText: '取消'
                })
                    .then(() => {
                        const userStore = useUserStore()
                        userStore.ClearStorage()
                        // router.push({ name: 'login', replace: true })
                    })
                break
            case 404:
                ElMessageBox.confirm(`
          <p>检测到接口错误${error}</p>
          <p>错误码<span style="color:red"> 404 </span>：此类错误多为接口未注册（或未重启）或者请求路径（方法）与api路径（方法）不符--如果为自动化代码请检查是否存在空格</p>
          `, '接口报错', {
                    dangerouslyUseHTMLString: true,
                    distinguishCancelAndClose: true,
                    confirmButtonText: '我知道了',
                    cancelButtonText: '取消'
                })
                break
            case 401:
                ElMessageBox.confirm(`
          <p>无效的令牌</p>
          <p>错误码:<span style="color:red"> 401 </span>错误信息:${error}</p>
          `, '身份信息', {
                    dangerouslyUseHTMLString: true,
                    distinguishCancelAndClose: true,
                    confirmButtonText: '重新登录',
                    cancelButtonText: '取消'
                })
                    .then(() => {
                        const userStore = useUserStore()
                        userStore.ClearStorage()
                        // router.push({ name: 'login', replace: true })
                    })
                break
        }

        return error
    }
)
export default service