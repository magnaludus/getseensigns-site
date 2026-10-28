// Yard sign: 4 mm corrugated plastic on an H stake. Packs show the first sign close and a few more behind it.
import {
  Group, Mesh, PlaneGeometry, BoxGeometry, MeshStandardMaterial, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color,
} from 'three';
import { packExtras, EXTRA_POSES, rad, cosDeg } from '../geom.js';
import { merge, bar, box3 } from '../build.js';
import { fluteCanvas } from '../procedural.js';
import { surface } from '../materials.js';

const THICK = 0.16;
const LIFT = 7;

function stakeGeometry() {
  const parts = [{ g: bar([-5, 0, 0], [-5, LIFT + 1, 0], 0.13, 6) }, { g: bar([5, 0, 0], [5, LIFT + 1, 0], 0.13, 6) }, { g: bar([-5, 3.4, 0], [5, 3.4, 0], 0.13, 6) }];
  return merge(parts);
}

export function buildYard(ctx) {
  const { spec, choices, mats } = ctx;
  const { w, h } = spec.artboard;
  const group = new Group();
  const art = [[], []];
  const base = [];
  const own = [];
  const backArt = String(choices && choices.print) === '2';

  // The flutes run vertically, parallel to the sign's short side (what we order, so the H stake slides up into
  // them). The cut top and bottom edges therefore show their cross section and the side edges are solid.
  const edgeTex = new CanvasTexture(fluteCanvas());
  edgeTex.colorSpace = SRGBColorSpace;
  edgeTex.wrapS = edgeTex.wrapT = RepeatWrapping;
  edgeTex.repeat.set(w / 0.26, 1);
  edgeTex.anisotropy = ctx.anisotropy;
  own.push(edgeTex);

  const faceGeo = new PlaneGeometry(w, h);
  const edgeGeo = new PlaneGeometry(w, THICK);
  const sideGeo = new BoxGeometry(THICK, h, THICK * 0.94);
  const stakeGeo = stakeGeometry();
  const pickables = [];

  const makeSign = () => {
    const front = new MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
    const back = backArt ? new MeshStandardMaterial({ roughness: 0.4, metalness: 0 }) : surface('plastic', ctx.base);
    const edge = new MeshStandardMaterial({ map: edgeTex, color: ctx.base, roughness: 0.5 });
    const side = surface('plastic', ctx.base);
    art[0].push(front);
    if (backArt) art[1].push(back);
    else base.push(back);
    base.push(edge, side);

    const sign = new Group();
    const face = new Mesh(faceGeo, front);
    face.position.z = THICK / 2;
    const rear = new Mesh(faceGeo, back);
    rear.position.z = -THICK / 2;
    rear.rotation.y = Math.PI;
    const top = new Mesh(edgeGeo, edge);
    top.rotation.x = -Math.PI / 2;
    top.position.y = h / 2;
    const bottom = new Mesh(edgeGeo, edge);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -h / 2;
    const left = new Mesh(sideGeo, side);
    left.position.x = -w / 2 + THICK / 2;
    const right = new Mesh(sideGeo, side);
    right.position.x = w / 2 - THICK / 2;
    [face, rear, top, bottom, left, right].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      sign.add(m);
    });
    sign.position.y = LIFT + h / 2;
    const holder = new Group();
    holder.add(sign);
    const stake = new Mesh(stakeGeo, mats.get('wire'));
    stake.castShadow = true;
    holder.add(stake);
    face.userData.side = 0;
    rear.userData.side = 1;
    return { holder, face, rear, mats: [front, back, edge, side] };
  };

  const first = makeSign();
  group.add(first.holder);
  pickables.push(first.face, first.rear);

  const extras = [];
  const n = packExtras(choices && choices.pack);
  for (let i = 0; i < n; i++) {
    const pose = EXTRA_POSES[i];
    const s = makeSign();
    s.holder.position.set(pose.x, 0, pose.z);
    s.holder.rotation.y = rad(pose.ry);
    group.add(s.holder);
    extras.push({ holder: s.holder, mats: s.mats, haze: 0.07 + 0.07 * i });
  }

  return {
    group,
    box: box3(-w / 2 - 1, 0, -THICK - 2, w / 2 + 1, LIFT + h + 1, THICK + 2),
    pickables,
    art,
    base,
    own,
    footprint: { w: w + 6, d: 16, kind: 'oval', opacity: 0.3 },
    // Pack signs fade toward the haze color of the scene, like distance fog.
    setHaze(color) {
      const c = new Color(color);
      extras.forEach((e) => e.mats.forEach((m) => {
        m.emissive.copy(c).multiplyScalar(e.haze);
      }));
    },
    // Hide the pack when the camera is behind the front sign.
    view(az) {
      const show = cosDeg(az) > -0.25;
      extras.forEach((e) => { e.holder.visible = show; });
    },
  };
}
