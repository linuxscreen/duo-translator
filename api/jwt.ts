import service from "@/utils/request";

export const jsonInBlacklist = () => {
    return service({
        url: '/jwt/jsonInBlacklist',
        method: 'post'
    })
}