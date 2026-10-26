<script setup lang="ts">
import { markRaw, onMounted, onUnmounted } from 'vue'

// Headless, so no <template>: an empty one compiles to an SSR render that writes nothing
defineOptions({ render: () => null })
import { useMessagesStore } from 'OOCS_LynxTheme/stores/global/messagesStore'
import { useRecaptchaStore } from 'OOCS_LynxReCaptcha/stores/recaptchaStore'
import { config } from 'OOCS_LynxTheme/utils/storeConfig'

/**
 * Google reCAPTCHA for the storefront
 */

type Rendering = { sitekey: string; size?: string; theme?: string; hl?: string; badge?: string }
type TypeSettings = { rendering: Rendering; invisible: boolean }
type ReCaptchaConfig = {
    failureMessage?: string
    types?: Record<string, TypeSettings>
    forms?: Record<string, string>
}

type GreCaptcha = {
    render(container: HTMLElement, parameters: Record<string, unknown>): number
    execute(widgetId: number): void
    reset(widgetId: number): void
    getResponse(widgetId: number): string
}

declare global {
    interface Window {
        grecaptcha?: GreCaptcha
        lynxRecaptchaOnLoad?: () => void
    }
}

const API_URL = 'https://www.google.com/recaptcha/api.js?onload=lynxRecaptchaOnLoad&render=explicit'

type Widget = {
    /** The form key it was drawn for; a host asked for another key gets a new widget. */
    key: string
    container: HTMLElement
    /** Resolves with the widget id once Google's script has drawn it. */
    ready: Promise<number>
    id?: number
    /** An invisible challenge is running; its callback clears this. */
    executing: boolean
    onToken: (() => void) | null
}

// Module level, not per instance: the script and the widgets outlive any one mount
const widgets = new WeakMap<HTMLElement, Widget>()
let api: Promise<GreCaptcha> | null = null

function loadApi(): Promise<GreCaptcha> {
    api ??= new Promise(resolve => {
        window.lynxRecaptchaOnLoad = () => resolve(window.grecaptcha!)
        const script = document.createElement('script')
        script.src = API_URL
        script.async = true
        document.head.appendChild(script)
    })
    return api
}

function recaptchaConfig(): ReCaptchaConfig {
    return config<ReCaptchaConfig>('recaptcha', {})
}

function settingsFor(key: string | undefined): TypeSettings | null {
    const { forms = {}, types = {} } = recaptchaConfig()
    const type = key ? forms[key] : undefined
    return type ? (types[type] ?? null) : null
}

/**
 * The room a widget takes, so the container holds it before Google draws inside
 */
function reservedHeight(settings: TypeSettings): string {
    if (settings.invisible) return ''
    return settings.rendering.size === 'compact' ? '144px' : '78px'
}

function notifyMissing(): void {
    const { failureMessage } = recaptchaConfig()
    if (failureMessage) useMessagesStore().add('error', failureMessage)
}

/**
 * The widget for `host` (a form, or an anchor element handed to resolve()), drawn once
 */
function mount(
    host: HTMLElement,
    key: string,
    settings: TypeSettings,
    place: (container: HTMLElement) => void
): Widget {
    const current = widgets.get(host)
    // A re-render can drop the container while the host element itself survives.
    if (current && current.key === key && host.contains(current.container)) return current
    current?.container.remove()

    const container = document.createElement('div')
    // Held before Google draws into it: the script arrives long after the container does
    const reserved = reservedHeight(settings)
    if (reserved) container.style.minHeight = reserved
    place(container)

    // Google treats an empty string as a value, not as "unset".
    const rendering = Object.fromEntries(Object.entries(settings.rendering).filter(([, value]) => value !== ''))

    const widget: Widget = {
        key,
        container,
        executing: false,
        onToken: null,
        ready: loadApi().then(grecaptcha => {
            widget.id = grecaptcha.render(container, {
                ...rendering,
                callback: () => {
                    widget.executing = false
                    widget.onToken?.()
                },
            })
            return widget.id
        }),
    }
    widgets.set(host, widget)
    return widget
}

/** Runs the invisible challenge (once, if already running) and resolves when a token is in. */
function execute(widget: Widget, id: number): Promise<void> {
    return new Promise(resolve => {
        widget.onToken = resolve
        if (!widget.executing) {
            widget.executing = true
            window.grecaptcha!.execute(id)
        }
    })
}

// ── Forms ────────────────────────────────────────────────────────────────────

/** The form-level block holding the submit button; the widget goes right above it. */
function actionsBlock(form: HTMLFormElement): HTMLElement | null {
    let el = form.querySelector<HTMLElement>('button:not([type]), [type=submit]')
    while (el && el.parentElement !== form) el = el.parentElement
    return el
}

function mountInForm(form: HTMLFormElement, settings: TypeSettings): Widget {
    return mount(form, form.dataset.recaptcha!, settings, container => {
        const slot = form.querySelector('[data-recaptcha-slot]')
        if (slot) {
            slot.replaceChildren(container)
        } else {
            container.className = 'mb-6'
            form.insertBefore(container, actionsBlock(form))
        }
    })
}

function onFocusIn(event: FocusEvent) {
    const form = event.target instanceof Element ? event.target.closest('form[data-recaptcha]') : null
    if (!(form instanceof HTMLFormElement)) return
    const settings = settingsFor(form.dataset.recaptcha)
    if (settings) mountInForm(form, settings)
}

function onSubmit(event: SubmitEvent) {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || !form.dataset.recaptcha) return
    const settings = settingsFor(form.dataset.recaptcha)
    if (!settings) return

    const widget = mountInForm(form, settings)
    if (widget.id !== undefined && window.grecaptcha!.getResponse(widget.id)) {
        // The token goes with this submit
        const id = widget.id
        setTimeout(() => window.grecaptcha!.reset(id))
        return
    }

    // No token yet: this submit ends here, and the form is submitted again once there is one
    event.preventDefault()
    event.stopImmediatePropagation()
    void challenge(form, widget, settings)
}

async function challenge(form: HTMLFormElement, widget: Widget, settings: TypeSettings) {
    const id = await widget.ready
    if (!window.grecaptcha!.getResponse(id)) {
        if (!settings.invisible) {
            // The checkbox can only be ticked by the visitor; the widget is now in view.
            notifyMissing()
            return
        }
        await execute(widget, id)
    }
    form.requestSubmit()
}

// ── Programmatic callers ─────────────────────────────────────────────────────

function mountAt(anchor: HTMLElement, key: string, settings: TypeSettings): Widget {
    return mount(anchor, key, settings, container => anchor.replaceChildren(container))
}

/**
 * recaptchaStore.prepare: drawn ahead of the action
 */
function prepare(key: string, anchor: HTMLElement): void {
    const settings = settingsFor(key)
    if (settings) mountAt(anchor, key, settings)
}

/** recaptchaStore.resolve: '' when the key is not protected, null when the visitor still has to tick. */
async function resolve(key: string, anchor: HTMLElement): Promise<string | null> {
    const settings = settingsFor(key)
    if (!settings) return ''

    const widget = mountAt(anchor, key, settings)
    const id = await widget.ready
    const grecaptcha = window.grecaptcha!
    if (!grecaptcha.getResponse(id)) {
        if (!settings.invisible) {
            anchor.scrollIntoView({ behavior: 'smooth', block: 'center' })
            notifyMissing()
            return null
        }
        await execute(widget, id)
    }
    const token = grecaptcha.getResponse(id)
    grecaptcha.reset(id)
    return token
}

const recaptcha = useRecaptchaStore()
// Raw, so the store hands back this same object and the unmount check below can find it
const provider = markRaw({ prepare, resolve })

onMounted(() => {
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('submit', onSubmit, true)
    recaptcha.provider = provider
})

onUnmounted(() => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('submit', onSubmit, true)
    if (recaptcha.provider === provider) recaptcha.provider = null
})
</script>
