// Entry list for the vendored Three.js bundle. Add a name here, run `npm run vendor`
// in .design-dev, and commit the rebuilt assets/design/vendor/three.module.min.js.
export {
  // renderer, scene graph, camera
  WebGLRenderer, Scene, PerspectiveCamera, Group, Object3D, Mesh, InstancedMesh, Color, Fog,
  // lights
  AmbientLight, HemisphereLight, DirectionalLight,
  // geometry
  BufferGeometry, BufferAttribute, Float32BufferAttribute, PlaneGeometry, BoxGeometry,
  CylinderGeometry, SphereGeometry, TorusGeometry, ExtrudeGeometry, ShapeGeometry,
  Shape, Path, CatmullRomCurve3, TubeGeometry, LatheGeometry,
  // materials and textures
  MeshStandardMaterial, MeshBasicMaterial, ShadowMaterial, CanvasTexture, Texture, TextureLoader,
  // environment lighting
  PMREMGenerator,
  // math
  Vector2, Vector3, Matrix4, Quaternion, Euler, MathUtils, Raycaster, Box3, Spherical,
  // constants
  SRGBColorSpace, ACESFilmicToneMapping, NeutralToneMapping, NoToneMapping, PCFShadowMap, PCFSoftShadowMap,
  DoubleSide, FrontSide, BackSide, RepeatWrapping, ClampToEdgeWrapping,
  LinearFilter, LinearMipmapLinearFilter, REVISION,
} from 'three';
