import { defineStore } from 'pinia'

/**
 * How code that is not a form works with reCAPTCHA
 */
export type RecaptchaProvider = {
    /** Draws the widget at `anchor` ahead of time when the key needs a visible one (v2 checkbox). */
    prepare(key: string, anchor: HTMLElement): void
    resolve(key: string, anchor: HTMLElement): Promise<string | null>
}

export const useRecaptchaStore = defineStore('recaptcha', {
    state: () => ({
        provider: null as RecaptchaProvider | null,
    }),
    actions: {
        prepare(key: string, anchor: HTMLElement): void {
            this.provider?.prepare(key, anchor)
        },
        /**
         * ''
         */
        async resolve(key: string, anchor: HTMLElement): Promise<string | null> {
            return this.provider ? this.provider.resolve(key, anchor) : ''
        },
    },
})
