import { h, icon } from '../dom.js';
import { addLogoFile, removeLogoById, MAX_LOGOS } from '../logos.js';
import { placeLogo, findElement, updateElement } from '../../model/document.js';
import { dpiLevel, effectiveDpi } from '../../model/specs.js';

export function createLogoTab(ctx) {
  const { store, env, actions } = ctx;
  const S = store.state;
  const el = h('div', { class: 'dz-tab-body' });
  const input = h('input', { type: 'file', class: 'dz-file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', multiple: true, 'aria-label': 'Upload a logo', onchange: () => take(input.files) });
  const upload = h('label', { class: 'dz-btn dz-btn-primary' });
  upload.innerHTML = icon('upload') + '<span>Upload a logo</span>';
  upload.append(input);
  const msg = h('p', { class: 'dz-help', role: 'status' });
  const list = h('ul', { class: 'dz-logos' });
  const detail = h('div', { class: 'dz-selected' });
  const drop = h('div', { class: 'dz-drop' }, upload, h('p', { class: 'dz-help' }, 'PNG, JPG, WebP or SVG, up to 25 MB. Your logo stays on your device until you send your proof request.'));
  el.append(drop, msg, list, detail, h('p', { class: 'dz-help' }, 'No logo yet? Skip this and tell us what you have when you send your proof request.'));

  ['dragover', 'dragenter'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => take(e.dataTransfer.files));

  async function take(files) {
    msg.textContent = '';
    for (const file of [...files]) {
      const res = await addLogoFile(ctx, file);
      if (!res.ok) {
        msg.textContent = res.message;
        continue;
      }
      place(res.id);
      ctx.track('logo_upload', { type: file.type });
    }
    input.value = '';
  }

  function place(logoId) {
    const { pi, si } = S.view;
    const res = placeLogo(S.doc, pi, si, logoId, env);
    if (res.id) store.commit(res.doc, { select: [res.id] });
    ctx.announce('Logo added to the design');
  }

  function cur() {
    if (S.selection.length !== 1) return null;
    const e = findElement(S.doc.project.pieces[S.view.pi].sides[S.view.si], S.selection[0]);
    return e && e.type === 'image' ? e : null;
  }

  function render() {
    list.textContent = '';
    const logos = S.doc.project.logos;
    for (const logo of logos) {
      const asset = S.assets.get(logo.id);
      const row = h('li', { class: 'dz-logo' });
      const thumb = h('span', { class: 'dz-logo-thumb' });
      if (asset) thumb.append(h('img', { src: asset.url, alt: '', width: 48, height: 48 }));
      row.append(
        thumb,
        h('span', { class: 'dz-logo-name' }, logo.name, h('small', null, logo.vector ? 'Vector' : `${logo.w} × ${logo.h} px`)),
        h('button', { type: 'button', class: 'dz-chip', onclick: () => place(logo.id) }, 'Add'),
        h('button', { type: 'button', class: 'dz-chip', 'aria-label': `Remove ${logo.name}`, onclick: () => removeLogoById(ctx, logo.id) }, 'Remove')
      );
      list.append(row);
    }
    upload.classList.toggle('is-disabled', logos.length >= MAX_LOGOS);
    input.disabled = logos.length >= MAX_LOGOS;

    detail.textContent = '';
    const e = cur();
    detail.hidden = !e;
    if (!e) return;
    detail.append(h('h2', { class: 'dz-h3' }, 'Selected logo'));
    const asset = e.logoId && S.assets.get(e.logoId);
    if (asset) {
      const spec = actions.spec();
      if (asset.vector) {
        detail.append(h('p', { class: 'dz-badge is-green' }, icon('check', 18), ' Vector artwork: sharp at any size'));
      } else {
        const dpi = effectiveDpi(asset.w, e.w);
        const level = dpiLevel(dpi, spec.dpi);
        const text = level === 'green' ? 'Sharp at this size' : level === 'amber' ? 'OK, but a bigger file would print crisper' : 'Too small: it will look soft or blocky';
        detail.append(h('p', { class: `dz-badge is-${level}` }, `${Math.round(dpi)} dpi · ${text}`));
        if (level !== 'green') ctx.track('dpi_warning', { level });
      }
      detail.append(h('p', { class: 'dz-help' }, 'Print needs about ' + spec.dpi.greenMin + ' dpi. If your file is small we will check it on your proof.'));
      const lock = h('input', { type: 'checkbox', id: 'dz-lock-aspect', checked: e.keepAspect !== false, onchange: () => actions.setElement(e.id, { keepAspect: lock.checked }) });
      detail.append(h('label', { class: 'dz-check', for: 'dz-lock-aspect' }, lock, h('span', null, 'Keep proportions (hold Shift to stretch)')));
      detail.append(h('button', { type: 'button', class: 'dz-chip', onclick: () => store.commit(updateElement(S.doc, S.view.pi, S.view.si, e.id, { logoId: null }, env)) }, 'Remove from design'));
    } else {
      detail.append(h('p', { class: 'dz-help' }, 'This is a logo spot. Upload a logo and it fills in here.'));
    }
  }

  return {
    el,
    onShow: render,
    update(state, keys) {
      if (keys.some((k) => ['doc', 'selection', 'assets', 'view'].includes(k))) render();
    },
  };
}
