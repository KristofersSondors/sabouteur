import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  CylinderGeometry,
  Color,
  Box3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedAvatar {
  model: Group;
  animations: any[];
}

const loader = new GLTFLoader();
const AVATAR_MODEL_PATHS = [
  '/assets/models/miner.glb',
  '/assets/models/dwarf.glb',
];
const AVATAR_SCALE = 1.6;

const placeholder = () => {
  const group = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.35, 0.45, 1.2, 8),
    new MeshStandardMaterial({ color: new Color('#7f8c8d'), metalness: 0.2, roughness: 0.8 }),
  );
  const head = new Mesh(
    new SphereGeometry(0.35, 16, 16),
    new MeshStandardMaterial({ color: new Color('#f2c078'), roughness: 0.7 }),
  );
  head.position.y = 0.9;
  group.add(body);
  group.add(head);
  group.scale.setScalar(AVATAR_SCALE);
  const box = new Box3().setFromObject(group);
  group.position.y -= box.min.y;
  return group;
};

export const loadAvatarModel = async (): Promise<LoadedAvatar> => {
  // Try to load custom avatar models (prefers miner.glb, falls back to dwarf.glb)
  for (const modelPath of AVATAR_MODEL_PATHS) {
    try {
      const gltf = await loader.loadAsync(modelPath);
      const avatar = gltf.scene;
      avatar.scale.setScalar(AVATAR_SCALE);
      avatar.traverse((child) => {
        if ('castShadow' in child) {
          // eslint-disable-next-line no-param-reassign
          (child as any).castShadow = true;
        }
        if ('receiveShadow' in child) {
          // eslint-disable-next-line no-param-reassign
          (child as any).receiveShadow = true;
        }
      });
      // Wrap in a container so the ground offset sticks even after we move the avatar
      const box = new Box3().setFromObject(avatar);
      const yOffset = -box.min.y;
      const container = new Group();
      avatar.position.y += yOffset;
      container.add(avatar);
      return { model: container, animations: gltf.animations };
    } catch (error) {
      console.warn(`Could not load avatar model at ${modelPath}`, error);
    }
  }

  console.warn('Could not load any avatar model, falling back to placeholder.');
  return { model: placeholder(), animations: [] };
};
