import * as THREE from "../../libs/three.js/build/three.module.js";
import {MOUSE} from "../defines.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";

export class MapControls extends EventDispatcher {
  constructor(viewer) {
    super(viewer);

    this.viewer = viewer;
    this.renderer = viewer.renderer;

    this.scene = null;
    this.sceneControls = new THREE.Scene();

    this.rotationSpeed = 5;

    this.minZoom = 10000;

    this.fadeFactor = 20;
    this.wheelDelta = 0;
    this.zoomDelta = new THREE.Vector3();
    this.panDelta = new THREE.Vector2(0, 0);
    this.camStart = null;

    this.touch = null;

    this.radiusDelta = 0;

    this.lastTap = 0;
    this.timeout;

    this.yawDelta = 0;
		this.pitchDelta = 0;

    this.previousTouch = null;
    this.previousDelta = null;
    this.allowedMove = true;
    this.pitchMoveAnimation = null;

    this.firstPosition = null;

    this.nbDrag = 0;

    this.tweens = [];

    this.keys = {
      CMD: [91, 224],
      CTRL: [17]
    };

    let drag = (e) => {
      if (e.type !== 'drag') {
        return;
      }
      if (e.drag.object !== null) {
        return;
      }

      if (!this.pivot) {
        return;
      }

      if (!this.allowedMove) {
        return;
      }

      if (e.drag.startHandled === undefined) {
        e.drag.startHandled = true;

        this.dispatchEvent({ type: 'start' });
      }

      this.nbDrag += 1;

      let camStart = this.camStart;
      let camera = this.scene.getActiveCamera();
      let view = this.viewer.scene.view;
      let mouse = e.drag.end;
      let domElement = this.viewer.renderer.domElement;
      let ih = this.viewer.inputHandler;
      let controlDown = this.keys.CTRL.some((e) => ih.pressedKeys[e]);
      let cmdDown = this.keys.CMD.some((e) => ih.pressedKeys[e]);

      if (e.drag.mouse === MOUSE.LEFT) {
        if (controlDown || cmdDown) {
          let ndrag = {
            x: e.drag.lastDrag.x / this.renderer.domElement.clientWidth,
            y: e.drag.lastDrag.y / this.renderer.domElement.clientHeight
          };
          this.yawDelta += ndrag.x * this.rotationSpeed;
          this.pitchDelta += ndrag.y * this.rotationSpeed;
          this.stopTweens();
        } else {
          this.move(mouse, camStart, camera, view, domElement);
        }
      }
    };

    let setupDownEvent = (vector) => {
      let I = Utils.getMousePointCloudIntersection(
        vector,
        this.scene.getActiveCamera(),
        this.viewer,
        this.scene.pointclouds,
        { pickClipped: false }
      );
      if (I) {
        this.pivot = I.location;
        this.camStart = this.scene.getActiveCamera().clone();
      }
    };

    let onMouseDown = (e) => {
      setupDownEvent(e.mouse);
    };

    let onTouchDown = (e) => {
      this.touch = e;
      if (e.touches.length === 2) {
        this.previousTouch = e;
        this.allowedMove = false;
      }
      let vector = new THREE.Vector2(
        Math.round(e.touches[0].clientX),
        Math.round(e.touches[0].clientY)
      );
      setupDownEvent(vector);
    };

    let drop = () => {
      this.dispatchEvent({ type: 'end' });
    };

    let onMouseUp = () => {
      this.camStart = null;
      this.pivot = null;
    };

    let onTouchUp = (e) => {
      this.previousTouch = e;
      this.allowedMove = true;
      this.camStart = null;
      this.pivot = null;
      this.firstPosition = null;
    };

    let scroll = (e) => {
			let resolvedRadius = this.scene.view.radius + this.radiusDelta;
      this.radiusDelta += -e.delta * resolvedRadius * 0.1;  
			this.stopTweens();
		};

    let onClick = (e) => {
      e.preventDefault();
      if (this.nbDrag < 15) {
        let vector = new THREE.Vector2(Math.round(e.x), Math.round(e.y));
        this.zoomToLocation(vector);
      }
      this.nbDrag = 0;
    };

    this.addEventListener('touchstart', onTouchDown);
    this.addEventListener('touchend', onTouchUp);
    this.addEventListener('drag', drag);
    this.addEventListener('drop', drop);
    this.addEventListener('mousewheel', scroll);
    this.addEventListener('mousedown', onMouseDown);
    this.addEventListener('mouseup', onMouseUp);

    this.renderer.domElement.addEventListener('click', onClick, false);
    this.viewer.addEventListener('focusing_finished', () => {
      this.minZoom = this.scene.view.position.z;
    })
  }

  setScene(scene) {
    this.scene = scene;
  }

  setMinZoom(z) {
    this.minZoom = z;
  }

  stop() {
    this.yawDelta = 0;
		this.pitchDelta = 0;
		this.radiusDelta = 0;
    this.panDelta.set(0, 0);
  }

  move(mouse, camStart, camera, view, domElement) {
    let ray = Utils.mouseToRay(
      mouse,
      camera,
      domElement.clientWidth,
      domElement.clientHeight
    );
    let plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      this.pivot
    );

    let distanceToPlane = ray.distanceToPlane(plane);

    if (distanceToPlane > 0) {
      let I = new THREE.Vector3().addVectors(
        camStart.position,
        ray.direction.clone().multiplyScalar(distanceToPlane)
      );

      let movedBy = new THREE.Vector3().subVectors(I, this.pivot);

      let newCamPos = camStart.position.clone().sub(movedBy);
      view.position.copy(newCamPos);

      {
        let distance = newCamPos.distanceTo(this.pivot);
        view.radius = distance;
        let speed = view.radius / 2.5;
        this.viewer.setMoveSpeed(speed);
      }
    }
  }

  zoomToLocation(mouse, shouldZoom = false) {
    let camera = this.scene.getActiveCamera();

    let I = Utils.getMousePointCloudIntersection(
      mouse,
      camera,
      this.viewer,
      this.scene.pointclouds
    );

    if (I === null) {
      return;
    }

    let targetRadius = 0;
    {
      let minimumJumpDistance = 0.2;

      let domElement = this.renderer.domElement;
      let ray = Utils.mouseToRay(
        mouse,
        camera,
        domElement.clientWidth,
        domElement.clientHeight
      );

      let nodes = I.pointcloud.nodesOnRay(I.pointcloud.visibleNodes, ray);
      let lastNode = nodes[nodes.length - 1];
      let radius = lastNode.getBoundingSphere(new THREE.Sphere()).radius;
      targetRadius = Math.min(this.scene.view.radius, radius);
      targetRadius = Math.max(minimumJumpDistance, targetRadius);
    }

    let d = this.scene.view.direction.multiplyScalar(-1);
    let cameraTargetPosition = new THREE.Vector3().addVectors(
      I.location,
      d.multiplyScalar(targetRadius)
    );
    cameraTargetPosition.z = this.scene.view.position.z / 2;

    let animationDuration = 600;
    let easing = TWEEN.Easing.Quartic.Out;

    {
      // animate
      let value = { x: 0 };
      let tween = new TWEEN.Tween(value).to({ x: 1 }, animationDuration);
      tween.easing(easing);
      this.tweens.push(tween);

      let startPos = this.scene.view.position.clone();
      let targetPos = cameraTargetPosition.clone();
      let startRadius = this.scene.view.radius;
      let targetRadius = cameraTargetPosition.distanceTo(I.location);

      tween.onUpdate(() => {
        let t = value.x;
        this.scene.view.position.x = (1 - t) * startPos.x + t * targetPos.x;
        this.scene.view.position.y = (1 - t) * startPos.y + t * targetPos.y;
        if (shouldZoom && !this.scene.pointclouds[0].intersectsPoint(targetPos)) {
          this.scene.view.position.z = (1 - t) * startPos.z + t * targetPos.z;
        }

        this.scene.view.radius = (1 - t) * startRadius + t * targetRadius;
        this.viewer.setMoveSpeed(this.scene.view.radius / 2.5);
      });

      tween.onComplete(() => {
        this.tweens = this.tweens.filter((e) => e !== tween);
      });

      tween.start();
    }
  }

  stopTweens () {
		this.tweens.forEach(e => e.stop());
		this.tweens = [];
	}

  update(delta) {
    let view = this.scene.view;

    { // apply rotation
			let progression = Math.min(1, this.fadeFactor * delta);

			let yaw = view.yaw;
			let pitch = view.pitch;
			let pivot = view.getPivot();

			yaw -= progression * this.yawDelta;
			pitch -= progression * this.pitchDelta;

			view.yaw = yaw;
      if (pitch < -0.035) {
        view.pitch = pitch;
      }
			
			let V = this.scene.view.direction.multiplyScalar(-view.radius);
			let position = new THREE.Vector3().addVectors(pivot, V);
      if (this.scene.pointclouds != undefined && this.scene.pointclouds[0] != undefined && !this.scene.pointclouds[0].intersectsPoint(position)) {
        view.position.copy(position);
      } else {
        this.stop();
      }
		}

    { // apply zoom
			let progression = Math.min(1, this.fadeFactor * delta);
			let radius = view.radius + progression * this.radiusDelta;

			let V = view.direction.multiplyScalar(-radius);
			let position = new THREE.Vector3().addVectors(view.getPivot(), V);
      if (this.radiusDelta < 0 && view.radius > 1 && this.scene.pointclouds != undefined && this.scene.pointclouds[0] != undefined && !this.scene.pointclouds[0].intersectsPoint(position)) {
        view.radius = radius;
        view.position.copy(position);
      } else if (this.radiusDelta > 0 && position.z < this.minZoom) {
        view.radius = radius;
        view.position.copy(position);
      }
		}

    { // decelerate over time
			let progression = Math.min(1, this.fadeFactor * delta);
      let attenuation = Math.max(0, 1 - this.fadeFactor * delta);

			this.yawDelta *= attenuation;
			this.pitchDelta *= attenuation;
			this.radiusDelta -= progression * this.radiusDelta;
      if (Math.abs(this.radiusDelta) < 0.1) {
        this.stop();
      }
    }
  }
}
