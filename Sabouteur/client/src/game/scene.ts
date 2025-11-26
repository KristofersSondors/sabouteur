import {
  AmbientLight,
  CanvasTexture,
  Clock,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Raycaster,
  Scene,
  AnimationMixer,
  AnimationAction,
  LoopOnce,
  LoopRepeat,
  Vector2,
  Vector3,
  WebGLRenderer,
  NearestFilter,
  RepeatWrapping,
  ConeGeometry,
  CylinderGeometry,
  CircleGeometry,
  MeshBasicMaterial,
  HemisphereLight,
  Box3,
  Quaternion,
  MathUtils,
  DoubleSide,
} from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { BoardState, BoardTile, PlayerStateSnapshot } from '../net/types';
import type { CardInstance, PathConnectors } from './cards';
import { CARD_LIBRARY, rotateConnectors } from './cards';
import { emitMovement } from '../net/client';
import { useGameStore } from '../state/store';
import { createBoardMesh, updateBoardMesh, boardTileFromIntersection, tileToPosition, TILE_WIDTH, TILE_HEIGHT, BOARD_COLUMNS, BOARD_ROWS } from './board';
import { loadAvatarModel, type LoadedAvatar } from './models';

const speed = 6.2;
const broadcastIntervalMs = 120;
const AVATAR_GROUND_LIFT = 0.05;

type TileClickHandler = (tile: BoardTile) => void;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

class InputManager {
  private readonly dom: HTMLElement;
  private readonly keys = new Set<string>();
  private readonly mouseDelta = { x: 0, y: 0 };
  public hasPointerLock = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.hasPointerLock) return;
    this.mouseDelta.x += e.movementX || 0;
    this.mouseDelta.y += e.movementY || 0;
  };
  private readonly onPointerLockChange = () => {
    this.hasPointerLock = document.pointerLockElement === this.dom;
  };

  constructor(dom: HTMLElement) {
    this.dom = dom;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  requestPointerLock() {
    this.dom.requestPointerLock?.();
  }

  consumeMouseDelta() {
    const dx = this.mouseDelta.x;
    const dy = this.mouseDelta.y;
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return { dx, dy };
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }
}

class ThirdPersonController {
  public readonly position = new Vector3();
  public readonly velocity = new Vector3();
  public yaw = 0;
  public pitch = 0;
  public bounds = { x: 50, z: 50 };

  private readonly camera: PerspectiveCamera;
  private readonly scene: Scene;
  private readonly input: InputManager;
  private model?: Group;
  private modelElevation = 0;
  private mixer?: AnimationMixer;
  private actions: Record<string, AnimationAction | undefined> = {};
  private locomotion?: AnimationAction;
  private current?: AnimationAction;
  private flipHeld = false;
  private swimHeld = false;

  private readonly moveSpeed = 3.2;
  private readonly sprintMultiplier = 1.8;
  private readonly turnSlerp = 0.12;
  private readonly cameraDistance = 4;
  private readonly cameraHeight = 2;
  private readonly pitchClamp = { min: -0.35, max: 0.5 };
  private readonly friction = 8;
  private readonly modelYawOffset = -Math.PI * 0.5;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly moveDir = new Vector3();
  private readonly quatY = new Quaternion();
  private readonly quatX = new Quaternion();
  private readonly camOffset = new Vector3(0, this.cameraHeight, this.cameraDistance);

  constructor(camera: PerspectiveCamera, scene: Scene, input: InputManager) {
    this.camera = camera;
    this.scene = scene;
    this.input = input;
  }

  setModel(model: Group, animations: any[] = []) {
    this.model = model;
    if (!model.parent) this.scene.add(model);
    model.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    const box = new Box3().setFromObject(model);
    const size = new Vector3();
    box.getSize(size);
    const targetHeight = 1.4;
    if (size.y > 0.0001) {
      const scale = targetHeight / size.y;
      if (scale < 0.25 || scale > 4) model.scale.setScalar(scale);
    }
    const recalced = new Box3().setFromObject(model);
    const size2 = new Vector3();
    recalced.getSize(size2);
    this.modelElevation = size2.y * 0.5;
    this.position.copy(model.position);
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    this.yaw = Math.atan2(forward.x, forward.z);

    if (animations.length > 0) {
      this.mixer = new AnimationMixer(model);
      const toAction = (clip: any) => this.mixer?.clipAction(clip);
      const nameFor = (c: any) => (c?.name || '').toLowerCase();
      const byName = (needle: string[]) =>
        animations.find((clip: any) => needle.some((n) => nameFor(clip).includes(n.toLowerCase())));
      const walk = byName(['walk']);
      const run = byName(['run', 'sprint']);
      const swim = byName(['swim']);
      const flip = byName(['flip', 'jump']);
      this.actions.walk = walk ? toAction(walk) : undefined;
      this.actions.run = run ? toAction(run) : undefined;
      this.actions.swim = swim ? toAction(swim) : undefined;
      this.actions.flip = flip ? toAction(flip) : undefined;
      [this.actions.walk, this.actions.run, this.actions.swim]
        .filter(Boolean)
        .forEach((a) => a?.setLoop(LoopRepeat, Infinity));
      this.locomotion = this.actions.walk || this.actions.run;
      if (this.actions.flip) {
        this.actions.flip.setLoop(LoopOnce, 1);
        this.actions.flip.clampWhenFinished = true;
      }
      if (this.actions.walk) {
        this.actions.walk.play();
        this.current = this.actions.walk;
      } else if (this.actions.run) {
        this.actions.run.play();
        this.current = this.actions.run;
      }
    }
  }

  private updateOrientation() {
    const { dx, dy } = this.input.consumeMouseDelta();
    const sens = 0.0028;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    this.pitch = clamp(this.pitch, this.pitchClamp.min, this.pitchClamp.max);
  }

  private computeMoveDir() {
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.crossVectors(this.forward, new Vector3(0, 1, 0)).normalize();
    this.moveDir.set(0, 0, 0);
    if (this.input.isDown('KeyW', 'ArrowUp')) this.moveDir.add(this.forward);
    if (this.input.isDown('KeyS', 'ArrowDown')) this.moveDir.sub(this.forward);
    if (this.input.isDown('KeyA', 'ArrowLeft')) this.moveDir.sub(this.right);
    if (this.input.isDown('KeyD', 'ArrowRight')) this.moveDir.add(this.right);
    this.moveDir.normalize();
    return this.moveDir;
  }

  private crossFade(toName: 'walk' | 'run' | 'swim' | 'flip') {
    const to = this.actions[toName];
    if (!to || this.current === to) return;
    const from = this.current;
    to.reset();
    to.enabled = true;
    if (toName === 'flip') {
      to.setLoop(LoopOnce, 1);
      to.clampWhenFinished = true;
    } else {
      to.setLoop(LoopRepeat, Infinity);
    }
    to.play();
    if (from) from.crossFadeTo(to, 0.12, false);
    this.current = to;
  }

  update(delta: number) {
    this.updateOrientation();
    const move = this.computeMoveDir();
    const isMoving = move.lengthSq() > 0.0001;
    const sprint = this.input.isDown('ShiftLeft', 'ShiftRight');
    const swim = this.input.isDown('KeyE');
    this.swimHeld = swim;

    if (isMoving) {
      const speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1);
      this.velocity.x = move.x * speed;
      this.velocity.z = move.z * speed;
    } else {
      this.velocity.x = MathUtils.damp(this.velocity.x, 0, this.friction, delta);
      this.velocity.z = MathUtils.damp(this.velocity.z, 0, this.friction, delta);
    }

    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.position.x = clamp(this.position.x, -this.bounds.x, this.bounds.x);
    this.position.z = clamp(this.position.z, -this.bounds.z, this.bounds.z);
    const y = this.modelElevation;

    if (this.model) {
      this.model.position.set(this.position.x, y, this.position.z);
      if (isMoving) {
        const targetRotY = Math.atan2(move.x, move.z) + this.modelYawOffset;
        const targetQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), targetRotY);
        this.model.quaternion.slerp(targetQuat, this.turnSlerp);
      }
    }

    if (this.mixer) {
      this.mixer.update(delta);
      const flipPressed = this.input.isDown('Digit6');
      if (flipPressed && !this.flipHeld && this.actions.flip) {
        this.flipHeld = true;
        this.crossFade('flip');
      } else if (!flipPressed) {
        this.flipHeld = false;
      }
      if (!isMoving) {
        // idle fallback -> slow walk clip
        if (this.locomotion) {
          this.locomotion.timeScale = 0.0;
        }
      } else if (swim && this.actions.swim) {
        this.crossFade('swim');
      } else if (sprint && (this.actions.run || this.actions.walk)) {
        if (this.actions.run) {
          this.crossFade('run');
        } else if (this.locomotion) {
          this.locomotion.timeScale = 1.5;
        }
      } else if (this.actions.walk) {
        this.crossFade('walk');
        if (this.locomotion) this.locomotion.timeScale = 1.0;
      }
    }

    const quatY = this.quatY.setFromAxisAngle(new Vector3(1, 0, 0), this.pitch);
    const quatX = this.quatX.setFromAxisAngle(new Vector3(0, 1, 0), this.yaw);
    const camOff = this.camOffset.clone().applyQuaternion(quatY).applyQuaternion(quatX);
    const camTarget = new Vector3(this.position.x, y, this.position.z);
    const desiredCam = camTarget.clone().add(camOff);
    this.camera.position.lerp(desiredCam, 1 - Math.pow(0.0001, delta));
    this.camera.lookAt(camTarget);
  }

  hasModel() {
    return !!this.model;
  }
}

export class GameScene {
  public readonly renderer: WebGLRenderer;

  public readonly scene: Scene;

  public readonly camera: PerspectiveCamera;

  private controls: PointerLockControls;

  private boardMeshMap = new Map<string, Group>();

  private boardGroup?: Group;

  private readonly raycaster = new Raycaster();

  private readonly pointer = new Vector2();
  private readonly lookDirection = new Vector3();

  private hoveredMesh?: Mesh;

  private readonly tileHandlers = new Set<TileClickHandler>();

  private readonly movement = { forward: 0, right: 0 };

  private readonly clock = new Clock();

  private lastBroadcast = 0;

  private readonly avatars = new Map<string, Group>();

  private baseAvatar?: Group;
  private baseAnimations: any[] = [];

  private thirdPerson = true;
  private selfId?: string;

  private previewMesh: Mesh;

  private previewSelected?: CardInstance;

  private previewRotationSteps = 0;

  private previewTexture?: CanvasTexture;

  private readonly mixers = new Map<
    string,
    { mixer: AnimationMixer; actions: Record<string, AnimationAction>; current?: AnimationAction }
  >();

  private readonly lastPlayerPose = new Map<string, { position: Vector3; time: number }>();

  private pointerLockAvailable = typeof document !== 'undefined' && 'pointerLockElement' in document;
  private pointerLockFailed = false;

  private susWallMesh?: Mesh;
  private leadWallMesh?: Mesh;
  private susTexture?: CanvasTexture;
  private leadTexture?: CanvasTexture;
  private input: InputManager;
  private thirdController?: ThirdPersonController;
  private nameLabels = new Map<string, Mesh>();
  private activePlayerId?: string;
  private resolveSelfId() {
    if (this.selfId) return this.selfId;
    const state = useGameStore.getState();
    const keys = Object.keys(state.players || {});
    if (keys.length > 0) {
      this.selfId = keys[0];
    }
    return this.selfId;
  }

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    this.scene = new Scene();
    this.scene.background = new Color('#8ec9ff');
    this.addEnvironment();
    this.input = new InputManager(this.renderer.domElement);

    this.camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 1.7, 5);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add((this.controls as any).object ?? (this.controls as any).getObject?.() ?? this.camera);

    const ambient = new AmbientLight('#f4f1de', 0.4);
    this.scene.add(ambient);
    const sun = new DirectionalLight('#fff3b0', 1.2);
    sun.position.set(8, 18, 8);
    sun.castShadow = true;
    this.scene.add(sun);
    const hemi = new HemisphereLight('#b5d9ff', '#404040', 0.5);
    this.scene.add(hemi);
    const sunDisc = new Mesh(new CircleGeometry(3, 32), new MeshBasicMaterial({ color: '#ffd166' }));
    sunDisc.position.set(-20, 30, -40);
    this.scene.add(sunDisc);

    // Create a proxy camera target for following self in third-person
    const proxy = new Group();
    proxy.position.set(0, 1.7, 0);
    this.scene.add(proxy);
    const controlsObject: Group | undefined = (this.controls as any).object ?? (this.controls as any).getObject?.();
    if (controlsObject) {
      controlsObject.add(proxy);
    }

    window.addEventListener('resize', this.handleResize);
    // Click canvas to enable mouse-look for third-person controller
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.pointerLockAvailable || this.pointerLockFailed) return;
      try {
        this.input.requestPointerLock();
      } catch (err) {
        console.warn('Pointer lock request threw, using fallback movement.', err);
        this.pointerLockFailed = true;
      }
    });

    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('mousedown', this.handlePointerDown);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // Preview plane for tile placement
    const previewGeom = new PlaneGeometry(TILE_WIDTH * 0.96, TILE_HEIGHT * 0.96);
    const previewMat = new MeshStandardMaterial({
      color: '#2a9df4',
      transparent: true,
      opacity: 0.35,
      side: 2,
    });
    this.previewMesh = new Mesh(previewGeom, previewMat);
    this.previewMesh.visible = false;
    this.previewMesh.rotation.x = -Math.PI / 2;
    this.previewMesh.position.y = 0.05;
    this.scene.add(this.previewMesh);

    this.initWallBoards();

    this.animate();
  }

  public mount(parent: HTMLElement) {
    parent.innerHTML = '';
    parent.appendChild(this.renderer.domElement);
  }

  public onTileClick(handler: TileClickHandler) {
    this.tileHandlers.add(handler);
  }

  public setBoard(board: BoardState | undefined) {
    if (!board) return;
    if (!this.boardGroup) {
      const { group, meshMap } = createBoardMesh(board);
      this.boardGroup = group;
      this.boardMeshMap = meshMap;
      this.scene.add(group);
    } else {
      updateBoardMesh(board, this.boardMeshMap);
    }
  }

  public async setPlayers(players: Record<string, PlayerStateSnapshot>) {
    this.selfId = useGameStore.getState().playerId || this.selfId || Object.keys(players)[0];
    if (!this.baseAvatar) {
      const loaded = await loadAvatarModel();
      this.baseAvatar = loaded.model;
      this.baseAnimations = loaded.animations;
    }
    Object.values(players).forEach((player) => {
      if (!this.avatars.has(player.id) && this.baseAvatar) {
        const avatar = this.baseAvatar.clone(true);
        avatar.position.copy(tileToPosition(BOARD_ROWS / 2, 0));
        avatar.position.y = AVATAR_GROUND_LIFT; // keep feet on the board plane
        this.scene.add(avatar);
        this.avatars.set(player.id, avatar);
        if (!(player.id === this.selfId && this.thirdPerson)) {
          this.setupMixer(player.id, avatar);
        }
        avatar.visible = this.isAvatarVisible(player.id);
        this.createOrUpdateLabel(player.id, player.name);
      }
    });
    [...this.avatars.keys()].forEach((id) => {
      if (!players[id]) {
        const avatar = this.avatars.get(id);
        if (avatar) {
          this.scene.remove(avatar);
        }
        this.avatars.delete(id);
      }
    });
    Object.values(players).forEach((player) => {
      const avatar = this.avatars.get(player.id);
      if (!avatar || !player.position) return;
      // When in third-person, let the local controller drive the self avatar transform
      if (this.thirdPerson && player.id === this.selfId) return;
      avatar.visible = this.isAvatarVisible(player.id);
      avatar.position.set(player.position.x, AVATAR_GROUND_LIFT, player.position.z);
      // Face the camera horizontally without tilting up/down
      this.lookDirection.subVectors(this.camera.position, avatar.position);
      this.lookDirection.y = 0;
      if (this.lookDirection.lengthSq() > 0) {
        const yaw = Math.atan2(this.lookDirection.x, this.lookDirection.z);
        avatar.rotation.set(0, yaw, 0);
      }
      this.updateRemoteAnimation(player.id, new Vector3(player.position.x, player.position.y, player.position.z));
      this.createOrUpdateLabel(player.id, player.name);
      this.updateLabelPosition(player.id);
    });
    this.ensureSelfAvatar();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this.updateMovement(delta);
    this.updateCameraRig(delta);
    this.mixers.forEach(({ mixer }) => mixer.update(delta));
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  };

  private updateMovement(delta: number) {
    // Always run third-person controller
    if (!this.thirdController) {
      this.thirdController = new ThirdPersonController(this.camera, this.scene, this.input);
    }
    if (!this.thirdController.hasModel()) {
      const selfAvatar = this.ensureSelfAvatar();
      if (selfAvatar) {
        this.thirdController.setModel(selfAvatar, this.baseAnimations);
        this.thirdController.position.copy(selfAvatar.position);
      }
    }
    if (!this.thirdController.hasModel()) return;
    const boundsX = (BOARD_COLUMNS * TILE_WIDTH) / 2 + 1;
    const boundsZ = (BOARD_ROWS * TILE_HEIGHT) / 2 + 1;
    this.thirdController.bounds = { x: boundsX, z: boundsZ };
    this.thirdController.update(delta);
    const pos = this.thirdController.position.clone();
    const selfAvatar = this.ensureSelfAvatar();
    if (selfAvatar) {
      selfAvatar.position.set(pos.x, AVATAR_GROUND_LIFT, pos.z);
    }
    const now = performance.now();
    if (now - this.lastBroadcast > broadcastIntervalMs) {
      this.lastBroadcast = now;
      const rotation = {
        x: this.camera.quaternion.x,
        y: this.camera.quaternion.y,
        z: this.camera.quaternion.z,
        w: this.camera.quaternion.w,
      };
      const position = { x: pos.x, y: pos.y + 1.5, z: pos.z };
      emitMovement(position, rotation);
      useGameStore.getState().setPose(position, rotation);
    }
    this.updateRemoteAnimation(this.selfId ?? 'self', pos.clone());
  }

  private updateCameraRig(_delta: number) {
    // camera follow handled inside third-person controller
  }

  private handleResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.boardGroup) return;
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.boardGroup.children, true);
    const mesh = intersections[0]?.object as any;
    if (mesh !== this.hoveredMesh) {
      if (this.hoveredMesh) {
        const material = this.hoveredMesh.material as any;
        material.emissive?.setHex(0);
      }
      this.hoveredMesh = mesh;
      if (mesh) {
        const material = mesh.material as any;
        material.emissive?.setHex(0x222222);
      }
    }
    this.updatePreview();
  };

  private handlePointerDown = () => {
    if (!this.hoveredMesh) return;
    const tile = boardTileFromIntersection(this.hoveredMesh);
    if (!tile) return;
    if (tile.tileType === 'start' || tile.tileType === 'goal' || tile.tileType === 'path') return;
    this.tileHandlers.forEach((handler) => handler(tile));
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.movement.forward = 1;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.movement.forward = -1;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.movement.right = -1;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.movement.right = 1;
        break;
      default:
        break;
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        if (this.movement.forward === 1) this.movement.forward = 0;
        break;
      case 'KeyS':
      case 'ArrowDown':
        if (this.movement.forward === -1) this.movement.forward = 0;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        if (this.movement.right === -1) this.movement.right = 0;
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.movement.right === 1) this.movement.right = 0;
        break;
      case 'KeyQ':
        // keep third-person always on; no toggle back to first-person
        this.thirdPerson = true;
        break;
      default:
        break;
    }
  };

  private toggleThirdPerson = () => {
    this.thirdPerson = true;
    const selfAvatar = this.ensureSelfAvatar();
    if (this.thirdPerson && selfAvatar) {
      if (!this.thirdController) {
        this.thirdController = new ThirdPersonController(this.camera, this.scene, this.input);
      }
      this.thirdController.setModel(selfAvatar, this.baseAnimations);
      this.thirdController.position.copy(selfAvatar.position);
      const forward = new Vector3();
      this.camera.getWorldDirection(forward);
      this.thirdController.yaw = Math.atan2(forward.x, forward.z);
      // enable pointer-lock mouse look while third-person is active
      this.input.requestPointerLock();
      if (this.selfId) {
        this.mixers.delete(this.selfId);
      }
    } else {
      document.exitPointerLock?.();
      if (!this.thirdPerson && selfAvatar && this.selfId && !this.mixers.has(this.selfId)) {
        this.setupMixer(this.selfId, selfAvatar);
      }
    }
    this.avatars.forEach((avatar, id) => {
      if (id === this.selfId) avatar.visible = this.thirdPerson;
    });
    // Snap camera once when toggled to avoid jitter on the next frame
    this.updateCameraRig(0);
  };

  public setPreviewSelection(card: CardInstance | undefined, rotation: number) {
    this.previewSelected = card;
    // Clamp to 0 or 180 only (0 => no flip, 2 => 180 flip)
    const norm = ((rotation % 4) + 4) % 4;
    this.previewRotationSteps = norm === 2 ? 2 : 0;
    this.updatePreviewTexture();
    this.updatePreview();
  }

  private updatePreview() {
    if (!this.hoveredMesh || !this.previewSelected) {
      this.previewMesh.visible = false;
      return;
    }
    const tile = boardTileFromIntersection(this.hoveredMesh);
    if (!tile || tile.tileType === 'start' || tile.tileType === 'goal' || tile.tileType === 'path') {
      this.previewMesh.visible = false;
      return;
    }
    const pos = tileToPosition(tile.row, tile.col);
    this.previewMesh.position.set(pos.x, 0.05, pos.z);
    this.previewMesh.rotation.x = -Math.PI / 2;
    this.previewMesh.rotation.y = 0; // orientation is encoded in the rotated texture
    this.previewMesh.visible = true;
  }

  private updatePreviewTexture() {
    if (!this.previewSelected) {
      this.previewMesh.material.map = null as any;
      this.previewMesh.material.needsUpdate = true;
      return;
    }
    const def = CARD_LIBRARY[this.previewSelected.cardKey];
    const connectors = def?.connectors;
    if (!connectors) {
      this.previewMesh.material.map = null as any;
      this.previewMesh.material.needsUpdate = true;
      return;
    }
    const rotated = rotateConnectors(connectors, this.previewRotationSteps);
    const tex = rotated ? this.buildConnectorTexture(rotated) : undefined;
    if (tex) {
      this.previewMesh.material.map = tex;
      this.previewMesh.material.needsUpdate = true;
    }
  }

  private buildConnectorTexture(connectors: PathConnectors) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#1a2a30';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#61c0ff';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    const c = size / 2;
    const margin = 28;
    const drawLeg = (dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + dx, c + dy);
      ctx.stroke();
    };
    if (connectors.north) drawLeg(0, -c + margin);
    if (connectors.south) drawLeg(0, c - margin);
    if (connectors.east) drawLeg(c - margin, 0);
    if (connectors.west) drawLeg(-c + margin, 0);
    ctx.beginPath();
    ctx.arc(c, c, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#61c0ff';
    ctx.fill();
    const texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    return texture;
  }

  private setupMixer(id: string, avatar: Group) {
    const mixer = new AnimationMixer(avatar);
    const actions: Record<string, AnimationAction> = {};
    const clipFor = (names: string[]) =>
      this.baseAnimations.find((clip: any) =>
        names.some((n) => clip.name.toLowerCase().includes(n.toLowerCase())),
      );
    const walkClip = clipFor(['walk']);
    const runClip = clipFor(['run', 'sprint']);
    const swimClip = clipFor(['swim']);
    const flipClip = clipFor(['flip', 'jump']);
    if (walkClip) actions.walk = mixer.clipAction(walkClip);
    if (runClip) actions.run = mixer.clipAction(runClip);
    if (swimClip) actions.swim = mixer.clipAction(swimClip);
    if (flipClip) {
      actions.flip = mixer.clipAction(flipClip);
      actions.flip.setLoop(LoopOnce, 1);
      actions.flip.clampWhenFinished = true;
    }
    this.mixers.set(id, { mixer, actions });
  }

  private playAnimation(id: string, key: 'walk' | 'run' | 'swim' | 'flip' | 'idle') {
    const entry = this.mixers.get(id);
    if (!entry) return;
    const { actions } = entry;
    const next =
      key === 'run'
        ? actions.run || actions.walk
        : key === 'walk'
        ? actions.walk
        : key === 'swim'
        ? actions.swim
        : key === 'flip'
        ? actions.flip
        : undefined;
    if (!next) return;
    if (entry.current === next && key !== 'flip') return;
    if (entry.current && entry.current !== next) {
      entry.current.fadeOut(0.15);
    }
    next.reset().fadeIn(0.1).play();
    entry.current = next;
  }

  private updateRemoteAnimation(id: string, position: Vector3) {
    const now = performance.now();
    const prev = this.lastPlayerPose.get(id);
    if (prev) {
      const dt = (now - prev.time) / 1000;
      const dist = position.distanceTo(prev.position);
      const speed = dt > 0 ? dist / dt : 0;
      if (speed > 3) {
        this.playAnimation(id, 'run');
      } else if (speed > 0.1) {
        this.playAnimation(id, 'walk');
      } else {
        this.playAnimation(id, 'idle');
      }
    }
    this.lastPlayerPose.set(id, { position: position.clone(), time: now });
  }

  public triggerEmote(key: 'flip' | 'swim') {
    this.mixers.forEach((_, id) => {
      this.playAnimation(id, key);
    });
  }

  private ensureSelfAvatar() {
    const id = this.resolveSelfId();
    if (!id || !this.baseAvatar) return undefined;
    let avatar = this.avatars.get(id);
    if (!avatar) {
      avatar = this.baseAvatar.clone(true);
      avatar.position.copy(this.getSelfSpawnPosition());
      avatar.visible = true;
      this.scene.add(avatar);
      this.avatars.set(id, avatar);
    }
    avatar.visible = true;
    return avatar;
  }

  private isAvatarVisible(id: string) {
    return true;
  }

  public setActivePlayer(playerId?: string) {
    this.activePlayerId = playerId;
    this.nameLabels.forEach((_label, id) => this.updateLabelTexture(id));
  }

  private createOrUpdateLabel(id: string, name: string) {
    const existing = this.nameLabels.get(id);
    if (existing) {
      this.updateLabelTexture(id, name);
      return;
    }
    const plane = new Mesh(
      new PlaneGeometry(1.4, 0.35),
      new MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, side: DoubleSide }),
    );
    plane.position.set(0, 1.8, 0);
    const avatar = this.avatars.get(id);
    if (avatar) {
      avatar.add(plane);
      this.nameLabels.set(id, plane);
      this.updateLabelTexture(id, name);
    }
  }

  private updateLabelTexture(id: string, nameOverride?: string) {
    const label = this.nameLabels.get(id);
    if (!label) return;
    const player = useGameStore.getState().players[id];
    const name = nameOverride ?? player?.name ?? id;
    const isActive = this.activePlayerId === id;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = isActive ? 'rgba(255,215,0,0.9)' : 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.fillStyle = isActive ? '#ffd166' : '#e9ecef';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    (label.material as MeshBasicMaterial).map = tex;
    (label.material as MeshBasicMaterial).transparent = true;
    (label.material as MeshBasicMaterial).depthTest = false;
    (label.material as MeshBasicMaterial).side = DoubleSide;
    (label.material as MeshBasicMaterial).needsUpdate = true;
  }

  private updateLabelPosition(id: string) {
    const avatar = this.avatars.get(id);
    const label = this.nameLabels.get(id);
    if (avatar && label) {
      label.position.set(0, 1.8, 0);
      // billboard toward camera
      label.lookAt(this.camera.position);
    }
  }

  private updateLabels() {
    this.nameLabels.forEach((_label, id) => this.updateLabelPosition(id));
  }

  private getSelfSpawnPosition() {
    const state = useGameStore.getState();
    const id = this.resolveSelfId();
    const player = id ? state.players[id] : undefined;
    if (player?.position) {
      return new Vector3(player.position.x, AVATAR_GROUND_LIFT, player.position.z);
    }
    return new Vector3(this.camera.position.x, AVATAR_GROUND_LIFT, this.camera.position.z);
  }

  private addEnvironment() {
    const treeMaterial = new MeshStandardMaterial({ color: '#324d2d' });
    const trunkMaterial = new MeshStandardMaterial({ color: '#6b4a2b' });
    const coneGeo = new ConeGeometry(0.6, 2, 8);
    const trunkGeo = new CylinderGeometry(0.15, 0.2, 0.6, 6);

    const makeTree = (x: number, z: number) => {
      const group = new Group();
      const trunk = new Mesh(trunkGeo, trunkMaterial);
      trunk.position.y = 0.3;
      const leaves = new Mesh(coneGeo, treeMaterial);
      leaves.position.y = 1.5;
      group.add(trunk);
      group.add(leaves);
      group.position.set(x, 0, z);
      group.castShadow = true;
      group.receiveShadow = true;
      this.scene.add(group);
    };

    const ringRadius = Math.max(BOARD_COLUMNS * TILE_WIDTH, BOARD_ROWS * TILE_HEIGHT);
    for (let i = 0; i < 32; i += 1) {
      const angle = (i / 32) * Math.PI * 2;
      const r = ringRadius * 0.7 + Math.random() * 4;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      makeTree(x, z);
    }

    const mountainMat = new MeshStandardMaterial({ color: '#2d3035', roughness: 0.9 });
    const mountainGeo = new ConeGeometry(4, 6, 6);
    const mountainOffsets = [
      { x: ringRadius * 1.2, z: ringRadius * 0.2 },
      { x: -ringRadius * 1.1, z: -ringRadius * 0.4 },
      { x: ringRadius * 0.3, z: -ringRadius * 1.3 },
    ];
    mountainOffsets.forEach(({ x, z }) => {
      const m = new Mesh(mountainGeo, mountainMat);
      m.position.set(x, 0, z);
      m.receiveShadow = true;
      this.scene.add(m);
    });

    const cloudGeo = new PlaneGeometry(3, 1.2);
    const cloudMat = new MeshStandardMaterial({ color: '#cfd5e2', transparent: true, opacity: 0.65, side: 2 });
    for (let i = 0; i < 6; i += 1) {
      const cloud = new Mesh(cloudGeo, cloudMat);
      cloud.position.set((Math.random() - 0.5) * ringRadius, 8 + Math.random() * 2, (Math.random() - 0.5) * ringRadius);
      cloud.rotation.x = -Math.PI / 2;
      this.scene.add(cloud);
    }
  }

  private initWallBoards() {
    const makeBoard = (isLeft: boolean) => {
      const tex = new CanvasTexture(document.createElement('canvas'));
      tex.image.width = 512;
      tex.image.height = 512;
      tex.needsUpdate = true;
      const mat = new MeshBasicMaterial({ map: tex, transparent: true });
      const plane = new Mesh(new PlaneGeometry(4, 4), mat);
      const x = (BOARD_COLUMNS * TILE_WIDTH) / 2 + 2;
      plane.position.set(isLeft ? -x : x, 2, 0);
      plane.rotation.y = isLeft ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(plane);
      return { plane, tex };
    };
    const left = makeBoard(true);
    const right = makeBoard(false);
    this.susWallMesh = left.plane;
    this.leadWallMesh = right.plane;
    this.susTexture = left.tex;
    this.leadTexture = right.tex;
  }

  public updateWallBoards(metrics: any, players: Record<string, any>) {
    if (this.susTexture) {
      const ctx = (this.susTexture.image as HTMLCanvasElement).getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#0c1118';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#7fb8d8';
        ctx.font = '22px sans-serif';
        ctx.fillText('Suspicion / Efficiency', 20, 32);
        const ids = Object.keys(players);
        ids.forEach((id, idx) => {
          const p = players[id];
          const sus = p.suspicion ?? 0;
          const eff = metrics?.efficiencyByPlayer?.[id] ?? 0;
          const y = 70 + idx * 40;
          ctx.fillStyle = '#adb5bd';
          ctx.font = '16px sans-serif';
          ctx.fillText(p.name, 20, y);
          ctx.fillStyle = '#2d3748';
          ctx.fillRect(180, y - 14, 200, 10);
          ctx.fillStyle = sus > 0.6 ? '#ef476f' : '#ffd166';
          ctx.fillRect(180, y - 14, Math.min(200, sus * 200), 10);
          ctx.fillStyle = eff >= 0 ? '#06d6a0' : '#ef476f';
          const w = Math.min(200, Math.max(-200, eff * 200));
          if (w >= 0) ctx.fillRect(180, y + 4, w, 8);
          else ctx.fillRect(180 + w, y + 4, -w, 8);
        });
        this.susTexture.needsUpdate = true;
      }
    }
    if (this.leadTexture) {
      const ctx = (this.leadTexture.image as HTMLCanvasElement).getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#0c1118';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#ffd166';
        ctx.font = '22px sans-serif';
        ctx.fillText('Leaderboard', 20, 32);
        const entries = Object.values(players)
          .sort(
            (a: any, b: any) =>
              (metrics?.goldByPlayer?.[b.id] ?? b.score ?? 0) - (metrics?.goldByPlayer?.[a.id] ?? a.score ?? 0),
          )
          .slice(0, 5);
        entries.forEach((p: any, idx: number) => {
          const y = 70 + idx * 40;
          const gold = metrics?.goldByPlayer?.[p.id] ?? p.score ?? 0;
          ctx.fillStyle = '#fff';
          ctx.font = '18px sans-serif';
          ctx.fillText(`${idx + 1}. ${p.name}`, 20, y);
          ctx.fillStyle = '#9ae6b4';
          ctx.fillText(`${gold.toFixed(0)} gold`, 240, y);
        });
        this.leadTexture.needsUpdate = true;
      }
    }
  }
}

export const initGameScene = () => new GameScene();
