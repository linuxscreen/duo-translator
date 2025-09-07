<template>
    <el-table :data="filterTableData" style="width: 100%">
        <el-table-column :label="t('name')" prop="name">
            <template #default="scope">
                <div style="display: flex; align-items: center">
                    <!--                    <el-icon><timer /></el-icon>-->
                    <el-image :src="'/' + scope.row.value + '-translate.svg'"></el-image>
                    <span style="margin-left: 10px">{{ scope.row.name }}</span>
                </div>
            </template>
        </el-table-column>
        <el-table-column :label="t('description')" prop="description"/>
        <el-table-column align="right">
            <template #header>
                <el-input v-model="search" :placeholder="t('typeToSearch')"/>
            </template>
            <template #default="scope">
                <el-switch
                    v-model="scope.row.enabled"
                    @click="serviceSwitch(scope.$index, scope.row)"
                    class="ml-2"
                    style="--el-switch-on-color: #13ce66; --el-switch-off-color: #ff4949"
                />
                <el-button :disabled="!scope.row.editable" @click="handleEdit(scope.$index, scope.row)"
                    style="margin-left: 10px">
                    {{ t('edit') }}
                </el-button>
            </template>
        </el-table-column>
    </el-table>
</template>

<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import {CONFIG_KEY, DB_ACTION, TRANS_SERVICE, TRANSLATE_SERVICES} from "@/entrypoints/constants";
import {getConfig,setConfig, sendMessageToBackground} from "@/entrypoints/utils";
import useI18n from '@/composables/useI18n';

const { t } = useI18n();
let disableServices :Set<string> = new Set()
let tableData = ref<TranslateService[]>([])
// let filterTableData = ref([])

async function serviceSwitch(index :number, row: TranslateService) {
    if (!row.enabled) {
        // Restrict at least one translation service
        console.log('filterTableData',filterTableData)
        let count = 0
        filterTableData.value.forEach((item) => {
            if (item.enabled) {
                count++
            }
        })
        if (count == 0) {
            row.enabled = true
            alert(t('keepAtLeastOneTranslationService'))
            return
        }
        // can not disable using service
        let currentService = await getConfig(CONFIG_KEY.TRANSLATE_SERVICE) as string
        if (currentService && currentService.includes(row.value)) {
            row.enabled = true
            alert(t('useTranslationServiceCannotBeDisabled'))
            return
        }
        disableServices.add(row.value)
        console.log('disableServices',disableServices)
        await setConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE, Array.from(disableServices))
    }else {
        if (disableServices.has(row.value)) {
            disableServices.delete(row.value)
            console.log('disableServices',disableServices)
            await setConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE, Array.from(disableServices))
        }
    }
}

onMounted(async () => {
    let ds  = await getConfig(CONFIG_KEY.DISABLED_TRANSLATE_SERVICE)
    if (ds) {
        disableServices = new Set(ds)
    }
    console.log("onMounted get config", disableServices);
    let translateServices = Array.from(TRANSLATE_SERVICES.values())
    translateServices.forEach((service) => {
        let enabled = true
        if (disableServices && disableServices.has(service.value)) {
            enabled = false
        }
        tableData.value.push({value:service.value,name: t(service.name), description: t(service.description), editable: service.editable,enabled:enabled})
    })
    // Object.entries(TRANS_SERVICE).forEach(([key, value]) => {
    //     let service = TRANSLATE_SERVICE_DETAIL.get(value)
    //     if (service) {
    //         let enabled = true
    //         if (disableServices && disableServices.has(value)) {
    //             enabled = false
    //         }
    //         tableData.value.push({value:service.value,name: t(service.name), description: t(service.description), editable: service.editable,enabled:enabled})
    //     }
    // });
    // filterTableData.value = computed(() =>
    //     tableData.filter(
    //         (data) =>
    //             !search.value ||
    //             data.name.toLowerCase().includes(search.value.toLowerCase())
    //     )
    // )
    // filterTableData.value = tableData.filter(
    //         (data) =>
    //             !search.value ||
    //             data.name.toLowerCase().includes(search.value.toLowerCase())
    // )

    console.log('filterTableData',filterTableData)
})


// const setConfig = async (key: CONFIG_KEY, value: any) => {
//     return sendMessageToBackground({
//         action: DB_ACTION.CONFIG_SET,
//         data: {name: key, value: value}
//     });
// }
// const getConfig = async (key: CONFIG_KEY): Promise<any> => {
//     return sendMessageToBackground({
//         action: DB_ACTION.CONFIG_GET,
//         data: {name: key}
//     });
// }

// browser.runtime.sendMessage("hello")
// getConfig(CONFIG_KEY.GLOBAL_SWITCH).then((value)=>{
//     console.log("get config",value)
// })
interface TranslateService {
    value : string
    name: string
    description: string
    editable: boolean
    enabled: boolean
}

const search = ref('')

const handleEdit = (index: number, row: TranslateService) => {
    console.log(index, row)
}
const handleDelete = (index: number, row: TranslateService) => {
    console.log(index, row)
}
// let tableData: TranslateService[] = []



const filterTableData = computed(() =>
    tableData.value.filter(
        (data) =>
            !search.value ||
            data.name.toLowerCase().includes(search.value.toLowerCase())
    )
)


</script>
