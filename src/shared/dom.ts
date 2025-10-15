export function qs<T extends Element = Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`Missing element: ${selector}`)
  return el as T
}

export function qsa<T extends Element = Element>(
  selector: string,
  root: ParentNode = document
): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[]
}

export function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement | Document | Window,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  el.addEventListener(type, handler as EventListener, options)
  return () => el.removeEventListener(type, handler as EventListener, options)
}

export function iconButton(svg: string, title: string, id?: string): HTMLButtonElement {
  const btn = document.createElement('button')
  if (id) btn.id = id
  btn.className =
    'p-1.5 rounded hover:bg-(--color-panel) text-(--color-muted) hover:text-(--color-accent)'
  btn.title = title
  btn.innerHTML = svg
  return btn
}
