import { afterEach, describe, expect, it, vi } from 'vitest'

const API_URL = 'https://www.google.com/recaptcha/api.js?onload=lynxRecaptchaOnLoad&render=explicit'

// As Plugin\AddReCaptchaConfig sends it
const config = {
    recaptcha: {
        failureMessage: 'reCAPTCHA verification failed.',
        types: {
            recaptcha: { rendering: { sitekey: 'site-v2', size: 'normal', theme: 'light', hl: '' }, invisible: false },
            recaptcha_v3: {
                rendering: { sitekey: 'site-v3', size: 'invisible', badge: 'bottomright', theme: 'light', hl: '' },
                invisible: true,
            },
        },
        forms: { contact: 'recaptcha', customer_login: 'recaptcha_v3' },
    },
}

/** Google's API, as far as the component uses it: an invisible widget gets its token on execute(). */
function fakeGrecaptcha() {
    const widgets: { container: HTMLElement; params: Record<string, unknown>; token: string }[] = []
    return {
        widgets,
        render: vi.fn(
            (container: HTMLElement, params: Record<string, unknown>) =>
                widgets.push({ container, params, token: '' }) - 1
        ),
        execute: vi.fn((id: number) => {
            widgets[id].token = 'token-invisible'
            ;(widgets[id].params.callback as () => void)()
        }),
        reset: vi.fn((id: number) => {
            widgets[id].token = ''
        }),
        getResponse: vi.fn((id: number) => widgets[id].token),
    }
}

// Unmounted after each test, which takes the document listeners off
const mounted: { unmount: () => void }[] = []

// The script and the widgets are module level: every test loads a fresh copy
async function load() {
    vi.resetModules()
    const { mountNode, hydrate } = await import('@oocs/module-lynx-theme/test')
    const { default: ReCaptcha } = await import('OOCS_LynxReCaptcha/Components/ReCaptcha.vue')
    const { useRecaptchaStore } = await import('OOCS_LynxReCaptcha/stores/recaptchaStore')
    const { useMessagesStore } = await import('OOCS_LynxTheme/stores/global/messagesStore')
    return { mountNode, hydrate, ReCaptcha, useRecaptchaStore, useMessagesStore }
}

/** The component mounted on a page, with Google's API answering through a fake. */
async function mount() {
    const { mountNode, ReCaptcha, useRecaptchaStore, useMessagesStore } = await load()
    const grecaptcha = fakeGrecaptcha()
    // api.js is never fetched: its onload callback is called by hand
    const scripts: string[] = []
    const appendChild = document.head.appendChild.bind(document.head)
    vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
        if (!(node instanceof HTMLScriptElement)) return appendChild(node)
        scripts.push(node.src)
        window.grecaptcha = grecaptcha
        queueMicrotask(() => window.lynxRecaptchaOnLoad?.())
        return node
    })
    const wrapper = mountNode(ReCaptcha, { config })
    mounted.push(wrapper)
    return { wrapper, recaptcha: useRecaptchaStore(), messages: useMessagesStore(), grecaptcha, scripts }
}

function form(key: string | null, inner = '<input name="email"><div class="actions"><button>Send</button></div>') {
    const el = document.createElement('form')
    if (key) el.dataset.recaptcha = key
    el.innerHTML = inner
    document.body.append(el)
    return el
}

const focus = (el: HTMLFormElement) =>
    el.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
const submit = (el: HTMLFormElement) => {
    const event = new Event('submit', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event
}

describe('ReCaptcha', () => {
    afterEach(() => {
        for (const wrapper of mounted.splice(0)) wrapper.unmount()
        delete window.grecaptcha
        delete window.lynxRecaptchaOnLoad
    })

    it('renders nothing', async () => {
        const { wrapper } = await mount()

        expect(wrapper.html()).toBe('')
    })

    it('requests nothing from Google until a protected form is focused', async () => {
        const { scripts, grecaptcha } = await mount()
        focus(form(null))
        focus(form('newsletter'))
        expect(scripts).toEqual([])

        const contact = form('contact')
        focus(contact)

        expect(scripts).toEqual([API_URL])
        await vi.waitFor(() => expect(grecaptcha.render).toHaveBeenCalledTimes(1))
        expect(grecaptcha.render.mock.calls[0][1]).toMatchObject({ sitekey: 'site-v2', size: 'normal', theme: 'light' })
        expect(grecaptcha.render.mock.calls[0][1]).not.toHaveProperty('hl')
    })

    it('draws the widget above the submit button, its room held', async () => {
        const { grecaptcha } = await mount()
        const contact = form('contact')
        focus(contact)
        focus(contact)

        await vi.waitFor(() => expect(grecaptcha.render).toHaveBeenCalledTimes(1))
        const container = grecaptcha.widgets[0].container
        expect(container.nextElementSibling).toBe(contact.querySelector('.actions'))
        expect(container.style.minHeight).toBe('78px')
    })

    it('draws the widget in the form slot when there is one', async () => {
        const { grecaptcha } = await mount()
        const contact = form('contact', '<input name="email"><div data-recaptcha-slot></div><button>Send</button>')
        focus(contact)

        await vi.waitFor(() => expect(grecaptcha.render).toHaveBeenCalled())
        expect(grecaptcha.widgets[0].container.parentElement).toBe(contact.querySelector('[data-recaptcha-slot]'))
    })

    it('lets a submit with a token through and resets the widget after it', async () => {
        const { grecaptcha } = await mount()
        const contact = form('contact')
        focus(contact)
        await vi.waitFor(() => expect(grecaptcha.render).toHaveBeenCalled())
        grecaptcha.widgets[0].token = 'token-ticked'

        expect(submit(contact).defaultPrevented).toBe(false)
        await vi.waitFor(() => expect(grecaptcha.reset).toHaveBeenCalledWith(0))
    })

    it('holds a checkbox form without a token and shows the failure message', async () => {
        const { grecaptcha, messages } = await mount()
        const contact = form('contact')
        const requestSubmit = vi.spyOn(contact, 'requestSubmit').mockImplementation(() => {})

        expect(submit(contact).defaultPrevented).toBe(true)

        await vi.waitFor(() =>
            expect(messages.items.map(message => message.text)).toEqual(['reCAPTCHA verification failed.'])
        )
        expect(grecaptcha.execute).not.toHaveBeenCalled()
        expect(requestSubmit).not.toHaveBeenCalled()
    })

    it('runs the invisible challenge and submits again once there is a token', async () => {
        const { grecaptcha } = await mount()
        const login = form('customer_login')
        const requestSubmit = vi.spyOn(login, 'requestSubmit').mockImplementation(() => {})

        expect(submit(login).defaultPrevented).toBe(true)

        await vi.waitFor(() => expect(requestSubmit).toHaveBeenCalledTimes(1))
        expect(grecaptcha.execute).toHaveBeenCalledWith(0)
        expect(grecaptcha.widgets[0].container.style.minHeight).toBe('')
    })

    it('plugs a provider into recaptchaStore while mounted', async () => {
        const { wrapper, recaptcha } = await mount()
        expect(recaptcha.provider).not.toBeNull()
        await expect(recaptcha.resolve('newsletter', document.createElement('div'))).resolves.toBe('')

        mounted.pop()
        wrapper.unmount()

        expect(recaptcha.provider).toBeNull()
    })

    it('resolves a token for a caller that is not a form', async () => {
        const { recaptcha, grecaptcha } = await mount()
        const anchor = document.createElement('div')
        document.body.append(anchor)

        await expect(recaptcha.resolve('customer_login', anchor)).resolves.toBe('token-invisible')
        expect(anchor.firstElementChild).toBe(grecaptcha.widgets[0].container)
        expect(grecaptcha.reset).toHaveBeenCalledWith(0)
    })

    it('answers null while the checkbox of a caller is not ticked', async () => {
        const { recaptcha, messages, grecaptcha } = await mount()
        const anchor = document.createElement('div')
        anchor.scrollIntoView = vi.fn()
        document.body.append(anchor)

        recaptcha.prepare('contact', anchor)
        await vi.waitFor(() => expect(grecaptcha.render).toHaveBeenCalledTimes(1))

        await expect(recaptcha.resolve('contact', anchor)).resolves.toBeNull()
        expect(anchor.scrollIntoView).toHaveBeenCalled()
        expect(messages.items.map(message => message.text)).toEqual(['reCAPTCHA verification failed.'])
        expect(grecaptcha.render).toHaveBeenCalledTimes(1)
    })

    it('server-renders and hydrates the same markup', async () => {
        const { hydrate, ReCaptcha } = await load()
        const { html, warnings } = await hydrate(ReCaptcha, { config })

        expect(html).not.toContain('recaptcha')
        expect(warnings).toEqual([])
    })
})
