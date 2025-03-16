<template>
    <el-dropdown-menu>
        <el-dropdown-item v-for="(item,index) in data"
                          :command="commandValue">
            {{ t(item.title) }}
        </el-dropdown-item>
    </el-dropdown-menu>
</template>

<script lang="ts">
import useI18n from "@/composables/useI18n.js";

export default {
    name: 'CustomDropdownMenu',
    inheritAttrs: false, // Properties are not automatically inherited because we have to manually transparently transmit them
    props: {
        // Here you can add some custom attributes
        data: {
            type: Array,
            default: () => []
        },
        commandValue: {
            type: String,
            default: ''
        },
        scrollable: {
            type: Boolean,
            default: false
        },
        height: {
            type: String,
            default: '420px'
        }

    },
    setup() {
        const {t} = useI18n();
        return {
            t
        }
    },
    data() {
        return {
            test: 'scroll',
            // Here you can add some custom data

        };
    },
    computed: {
        dropdownStyles() {
            // Dynamically bind CSS variables to ensure that they only work for the current component
            return {
                '--max-height': '420px',
                '--overflow-y': 'scroll'
            };
        },
        customClass() {
            // Here you can add some custom logic to decide on the class name
            return {
                'scrollable': this.scrollable
            };
        }
    },
    mounted() {
    }
};
</script>

<style scoped>
.el-dropdown-menu {
    max-height: 420px;
    /*overflow-y: v-bind(test);*/
    /*overflow-x: hidden;*/
}

.el-dropdown-menu {
    /*max-height: var(--max-height); // Dynamically use CSS variables defined inside the component*/
    /*overflow-y: var(--overflow-y); // Dynamically use CSS variables defined inside the component*/
}

.my-custom-class {
    /* customStyles */
}
</style>
