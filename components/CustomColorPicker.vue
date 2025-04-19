<script lang="ts">
import { ref, defineComponent, nextTick } from 'vue';
import { rgbToHex } from "@/entrypoints/utils";
import { ElMessage, ElColorPicker } from "element-plus";
import useI18n from "@/composables/useI18n";

export default {
    name: 'CustomColorPicker',
    inheritAttrs: false, // Properties are not automatically inherited because we have to manually transparently transmit them
    props: {
        bgColor: {
            type: String,
            default: '#ffffff' // The default color is white
        },
        customClass: {
            type: String,
            default: ''
        },
        onChecked: {
            type: Object,
            default: {}
        },
        activePreSelected: {},
        modelValue: {
            type: String,
            required: true,
        },
        selectedIndex: {
            type: Number,
            required: true,
        },
        colorItems: {
            type: Array,
            required: false,
            default: () => ['', '#df5f47', '#57a0ee', '#faec63', '#73b364']
        }
    },
    data() {
        return {
            colorPicked: '',
            // colorPicked: this.modelValue,
            'my-custom-class': true,
            preSelectedIndex: 0,

        };
    },
    setup() {
        const { t } = useI18n();
        const colorPickerComponent = ref<InstanceType<typeof ElColorPicker> | null>(null)
        const callInternalMethod = () => {
            if (colorPickerComponent.value) {
                colorPickerComponent.value.show();
            }
        };
        return {
            t,
            colorPickerComponent,
            callInternalMethod,
        };
    },
    watch: {
        modelValue(newValue, oldValue) {
            this.colorPicked = newValue;
            // console.log('modelValue', newValue, oldValue)
            let ele = this.$el.querySelector('#colorPickBox');
            ele.setAttribute('data-custom-color', newValue)

        },
        selectedIndex(val, old) {
            const elements = this.$el.querySelectorAll('.color-item');
            // Gets the index of the currently selected color block
            for (let i = 0; i < elements.length; i++) {
                let ele = elements[i];
                ele.classList.remove('active');
            }
            // get the element corresponding to the color block according to the value prop (i.e. index)
            const selectedElement = elements[val];
            selectedElement.classList.add('active')
        }
    },
    methods: {
        test() {
            // console.log('test', this.modelValue)
        },
        checkedColor(event) {
            // two color blocks cannot be the same color
            let pickers = document.querySelectorAll(".color-conflict");
            if (event.target.parentNode.classList.contains('color-conflict')) {
                for (let i = 0; i < pickers.length; i++) {
                    let picker = pickers[i];
                    if (picker !== this.$el) {
                        let elements = picker.querySelector('#colorPickBox');
                        let color = elements?.getAttribute('data-custom-color');
                        if (event.target.style.color != '' && color == rgbToHex(event.target.style.color).toUpperCase()) {
                            ElMessage({
                                showClose: true,
                                offset: 270,
                                message: this.t('translationColorPropNotSame'),
                                type: 'error',
                            })
                            return;
                        }
                    }
                }
            }
            let elements = this.$el.querySelectorAll('.color-item');
            let ele = event.target
            let color = ele.style.color
            let hexColor = this.rgbToHex(color).toUpperCase();
            // ele.classList.add('active');
            this.preSelectedIndex = Array.from(elements).indexOf(ele)
            this.colorPicked = hexColor;
            this.$emit('update:modelValue', hexColor);
            for (let i = 0; i < elements.length; i++) {
                if (elements[i] === ele) {
                    this.$emit('update:selectedIndex', i);
                }
            }
        },
        showColorPicker() {
            this.$emit('update:selectedIndex', 5);
            this.callInternalMethod();
        },
        onColorChange(value) {
            let pickers = document.querySelectorAll(".bg-color-pick-list");
            for (let i = 0; i < pickers.length; i++) {
                let picker = pickers[i];
                if (picker !== this.$el) {
                    let elements = picker.querySelector('#colorPickBox');
                    let color = elements?.getAttribute('data-custom-color');
                    if (color == value) {
                        ElMessage({
                            showClose: true,
                            offset: 270,
                            message: this.t('translationColorPropNotSame'),
                            type: 'error',
                        })
                        this.$el.querySelector(".color-item.active").classList.remove("active")
                        let preSelected = this.$el.querySelector(".color-item:nth-child(" + (this.preSelectedIndex + 1) + ")")
                        preSelected.classList.add("active")
                        this.$emit('update:modelValue', preSelected.style.color);
                        this.$emit('update:selectedIndex', this.preSelectedIndex);
                        return
                    }
                    this.colorPicked = value;
                    this.$emit('update:modelValue', value);
                }
            }

        },
        rgbToHex(rgb) {
            // Extract the RGB values
            const result = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
            return result ? "#" +
                ("0" + parseInt(result[1], 10).toString(16)).slice(-2) +
                ("0" + parseInt(result[2], 10).toString(16)).slice(-2) +
                ("0" + parseInt(result[3], 10).toString(16)).slice(-2) : rgb;
        },
    },
    mounted() {
        // If the color of the first color block is empty, set it to transparent
        let elements = this.$el.querySelectorAll('.color-item');
        let ele = elements[0] as HTMLElement;
        if (ele.style.color == '') {
            ele.style.backgroundColor = '#EFEFEF';
            ele.style.backgroundImage = 'url("/transparentRectangle.svg")';
        }
    }
}

</script>

<template>
    <section v-bind="$attrs" class="bg-color-pick-list" :class="customClass">
        <span class="color-item" v-for="(colorItem) in colorItems" @click="checkedColor($event)"
            :style="{ color: colorItem }"></span>
        <span class="color-item" id="colorPickBox" :data-custom-color="colorPicked" @click="showColorPicker()">
            <el-color-picker id="colorPicker" ref="colorPickerComponent" v-bind="$attrs" @change="onColorChange" />
        </span>
    </section>

</template>

<style scoped>
:root {
    --main-bg-color: red;
}

.customClass {
    background-color: red;
}

.bg-color-pick-list {
    width: 132px;
    box-sizing: border-box;
    padding: 1px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    backface-visibility: hidden;
}

.el-color-picker__panel {
    position: absolute;
    top: 165px !important;
}

.color-item:nth-last-child(1) {
    background-color: #EFEFEF;
    background-image: url("/colourfulRectangle.svg");

}

.color-item {
    display: inline-block;
    position: relative;
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    background-color: currentcolor;

}
</style>