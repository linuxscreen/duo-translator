export const jsonInBlacklist = () => {
    return fetch('/jwt/jsonInBlacklist',{
        method: 'POST'
    })
}