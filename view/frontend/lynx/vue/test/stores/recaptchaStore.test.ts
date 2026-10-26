import { useRecaptchaStore } from 'OOCS_LynxReCaptcha/stores/recaptchaStore'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('recaptchaStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('answers an empty token without a provider, so the caller sends as usual', async () => {
        const store = useRecaptchaStore()
        const anchor = document.createElement('div')

        expect(() => store.prepare('place_order', anchor)).not.toThrow()
        await expect(store.resolve('place_order', anchor)).resolves.toBe('')
    })

    it('hands both calls to the provider plugged in', async () => {
        const store = useRecaptchaStore()
        const provider = { prepare: vi.fn(), resolve: vi.fn().mockResolvedValue('token-123') }
        const anchor = document.createElement('div')
        store.provider = provider

        store.prepare('place_order', anchor)
        const token = await store.resolve('place_order', anchor)

        expect(provider.prepare).toHaveBeenCalledWith('place_order', anchor)
        expect(provider.resolve).toHaveBeenCalledWith('place_order', anchor)
        expect(token).toBe('token-123')
    })

    it('passes on null when the visitor still has to tick the checkbox', async () => {
        const store = useRecaptchaStore()
        store.provider = { prepare: vi.fn(), resolve: vi.fn().mockResolvedValue(null) }

        await expect(store.resolve('place_order', document.createElement('div'))).resolves.toBeNull()
    })
})
