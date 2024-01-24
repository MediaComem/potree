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

    this.rotationSpeed = 10;

    this.fadeFactor = 20;
    this.wheelDelta = 0;
    this.zoomDelta = new THREE.Vector3();
    this.camStart = null;

    this.touch = null;

    this.lastTap = 0;
    this.timeout;

    this.previousTouch = null;
    this.previousDelta = null;
    this.allowedMove = true;
    this.pitchMoveAnimation = null;
    this.shouldPitchMove = false;

    this.firstPosition = null;

    this.nbDrag = 0;

    this.tweens = [];

    this.minZPosition = 300;

    this.keys = {
      CMD: [91, 224],
      CTRL: [17]
    };

    {
      let sg = new THREE.SphereGeometry(1, 16, 16);
      let sm = new THREE.MeshNormalMaterial();
      this.pivotIndicator = new THREE.Mesh(sg, sm);
      this.pivotIndicator.visible = false;
      this.sceneControls.add(this.pivotIndicator);
    }

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
          this.moveCameraAngle(
            view,
            e.drag.lastDrag.x,
            e.drag.lastDrag.y,
            0.5,
            0.2
          );
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
        this.pivotIndicator.visible = true;
        this.pivotIndicator.position.copy(I.location);
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
        this.firstPosition = getCoordinateMoveDrag(e);
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
      this.pivotIndicator.visible = false;
    };

    let detectDoubleTapClosure = () => {
      const curTime = new Date().getTime();
      const tapLen = curTime - this.lastTap;
      let vector = new THREE.Vector2(
        Math.round(this.touch.touches[0].clientX),
        Math.round(this.touch.touches[0].clientY)
      );
      if (tapLen < 500 && tapLen > 0) {
        if (this.nbDrag < 15) {
          this.zoomToLocation(vector, true);
        }
      } else {
        this.timeout = setTimeout(() => {
          clearTimeout(this.timeout);
        }, 500);
        if (this.nbDrag < 15) {
          this.zoomToLocation(vector, false);
        }
      }
      this.lastTap = curTime;
    };

    let onTouchUp = (e) => {
      if (this.touch.touches.length == 1) {
        detectDoubleTapClosure(e);
      }
      this.previousTouch = e;
      this.allowedMove = true;
      this.camStart = null;
      this.pivot = null;
      this.pivotIndicator.visible = false;
      this.firstPosition = null;
      this.nbDrag = 0;
    };

    let scroll = (e) => {
      let vector = new THREE.Vector2(
        Math.round(this.renderer.domElement.clientWidth / 2),
        Math.round(this.renderer.domElement.clientHeight / 2)
      );
      let I = Utils.getMousePointCloudIntersection(
        vector,
        this.scene.getActiveCamera(),
        this.viewer,
        this.scene.pointclouds,
        { pickClipped: false }
      );
      if (I != null && I.distance > 200 && e.delta == 1) {
        this.wheelDelta += e.delta;
      } else if (
        I != null &&
        I.distance < 200 &&
        I.distance > 150 &&
        this.viewer.scene.view.pitch < 0 &&
        e.delta == 1
      ) {
        this.shouldPitchMove = true;
        this.wheelDelta += e.delta;
      } else if (I == null) {
        this.wheelDelta += e.delta;
      } else if (e.delta == -1) {
        this.wheelDelta += e.delta;
        this.shouldPitchMove = false;
      }
    };

    let getCoordinateMoveDrag = (e) => {
      let prev = this.previousTouch;
      let curr = e;

      let prevDX = Math.abs(prev.touches[0].pageX - prev.touches[1].pageX);
      let prevDY = Math.abs(prev.touches[0].pageY - prev.touches[1].pageY);

      let currDX = Math.abs(curr.touches[0].pageX - curr.touches[1].pageX);
      let currDY = Math.abs(curr.touches[0].pageY - curr.touches[1].pageY);

      return {
        x: Math.abs(currDX + prevDX) / 2,
        y: Math.abs(currDY + prevDY) / 2
      };
    };

    let touchemove = (e) => {
      if (e.touches.length === 2) {
        let move = getCoordinateMoveDrag(e);
        if (
          Math.abs(move.x - this.firstPosition.x) > 30 ||
          Math.abs(move.y - this.firstPosition.y) > 30
        ) {
          let prev = this.previousTouch;
          let curr = e;

          let prevDX = prev.touches[0].pageX - prev.touches[1].pageX;
          let prevDY = prev.touches[0].pageY - prev.touches[1].pageY;
          let prevDist = Math.sqrt(prevDX * prevDX + prevDY * prevDY);

          let currDX = curr.touches[0].pageX - curr.touches[1].pageX;
          let currDY = curr.touches[0].pageY - curr.touches[1].pageY;
          let currDist = Math.sqrt(currDX * currDX + currDY * currDY);

          let delta = currDist / prevDist;
          let vector = new THREE.Vector2(
            Math.round(this.touch.touches[0].pageX),
            Math.round(this.touch.touches[0].pageY)
          );
          let I = Utils.getMousePointCloudIntersection(
            vector,
            this.scene.getActiveCamera(),
            this.viewer,
            this.scene.pointclouds,
            { pickClipped: false }
          );
          if (this.previousDelta == null) {
            this.previousDelta = delta;
          } else if (
            this.previousDelta < delta &&
            I != null &&
            I.distance < 300 &&
            I.distance > 200 &&
            this.viewer.scene.view.pitch < 0
          ) {
            this.shouldPitchMove = true;
            this.wheelDelta += 0.2;
            this.previousDelta = delta;
          } else if (
            this.previousDelta < delta &&
            I != null &&
            I.distance > 300
          ) {
            this.wheelDelta += 0.2;
            this.previousDelta = delta;
          } else if (this.previousDelta > delta) {
            this.wheelDelta += -0.2;
            this.previousDelta = delta;
            this.shouldPitchMove = false;
          }
        } else if (
          (Math.abs(move.x - this.firstPosition.x) > 5 &&
            Math.abs(move.x - this.firstPosition.x) < 15) ||
          (Math.abs(move.y - this.firstPosition.y) > 5 &&
            Math.abs(move.y - this.firstPosition.y) < 15)
        ) {
          let view = this.viewer.scene.view;
          let prev = this.previousTouch;
          let curr = e;
          let prevMeanX = (prev.touches[0].pageX + prev.touches[1].pageX) / 2;
          let prevMeanY = (prev.touches[0].pageY + prev.touches[1].pageY) / 2;

          let currMeanX = (curr.touches[0].pageX + curr.touches[1].pageX) / 2;
          let currMeanY = (curr.touches[0].pageY + curr.touches[1].pageY) / 2;
          this.moveCameraAngle(
            view,
            currMeanX - prevMeanX,
            currMeanY - prevMeanY,
            0.05,
            0.02
          );
        }
      }
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
    this.addEventListener('touchmove', touchemove);
    this.addEventListener('drag', drag);
    this.addEventListener('drop', drop);
    this.addEventListener('mousewheel', scroll);
    this.addEventListener('mousedown', onMouseDown);
    this.addEventListener('mouseup', onMouseUp);

    this.renderer.domElement.addEventListener('click', onClick, false);
  }

  setScene(scene) {
    this.scene = scene;
  }

  stop() {
    this.wheelDelta = 0;
    this.zoomDelta.set(0, 0, 0);
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

  moveCameraAngle(view, xDrag, yDrag, yawSpeed, pitchSpeed) {
    let ndrag = {
      x: xDrag / this.renderer.domElement.clientWidth,
      y: yDrag / this.renderer.domElement.clientHeight
    };

    let yawDelta = -ndrag.x * this.rotationSpeed * yawSpeed;
    let pitchDelta = -ndrag.y * this.rotationSpeed * pitchSpeed;

    let originalPitch = view.pitch;
    let tmpView = view.clone();
    tmpView.pitch = tmpView.pitch + pitchDelta;
    pitchDelta = tmpView.pitch - originalPitch;

    let pivotToCam = new THREE.Vector3().subVectors(view.position, this.pivot);
    let pivotToCamTarget = new THREE.Vector3().subVectors(
      view.getPivot(),
      this.pivot
    );
    let side = view.getSide();

    if (view.pitch + pitchDelta < 0) {
      pivotToCam.applyAxisAngle(side, pitchDelta);
      pivotToCamTarget.applyAxisAngle(side, pitchDelta);
    }
    pivotToCam.applyAxisAngle(new THREE.Vector3(0, 0, 1), yawDelta);
    pivotToCamTarget.applyAxisAngle(new THREE.Vector3(0, 0, 1), yawDelta);

    let newCam = new THREE.Vector3().addVectors(this.pivot, pivotToCam);

    view.position.copy(newCam);
    view.yaw += yawDelta;
    if (view.pitch + pitchDelta < 0) {
      view.pitch += pitchDelta;
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
        if (shouldZoom) {
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

  zoomIn() {
    this.wheelDelta += 1;
  }

  zoomOut() {
    this.wheelDelta += -1;
  }

  update(delta) {
    let view = this.scene.view;
    let fade = Math.pow(0.5, this.fadeFactor * delta);
    let progression = 1 - fade;
    let camera = this.scene.getActiveCamera();

    // compute zoom
    if (this.wheelDelta !== 0) {
      let I = Utils.getMousePointCloudIntersection(
        this.viewer.inputHandler.mouse,
        this.scene.getActiveCamera(),
        this.viewer,
        this.scene.pointclouds
      );

      if (I) {
        let resolvedPos = new THREE.Vector3().addVectors(
          view.position,
          this.zoomDelta
        );
        let distance = I.location.distanceTo(resolvedPos);
        let jumpDistance = distance * 0.2 * this.wheelDelta;
        let targetDir = new THREE.Vector3().subVectors(
          I.location,
          view.position
        );
        targetDir.normalize();

        resolvedPos.add(targetDir.multiplyScalar(jumpDistance));
        this.zoomDelta.subVectors(resolvedPos, view.position);

        {
          let distance = resolvedPos.distanceTo(I.location);
          view.radius = distance;
          let speed = view.radius / 2.5;
          this.viewer.setMoveSpeed(speed);
        }
      }
    }

    // apply zoom
    if (this.zoomDelta.length() !== 0) {
      let p = this.zoomDelta.clone().multiplyScalar(progression);
      let newPos = new THREE.Vector3().addVectors(view.position, p);
      view.position.copy(newPos);
      if (this.shouldPitchMove) {
        if (this.viewer.scene.view.pitch > -0.1) {
          this.shouldPitchMove = false;
          this.viewer.scene.view.pitch = -0.1;
        } else {
          this.viewer.scene.view.pitch += 0.01;
        }
      }
    }

    if (this.pivotIndicator.visible) {
      let distance = this.pivotIndicator.position.distanceTo(view.position);
      let pixelwidth = this.renderer.domElement.clientwidth;
      let pixelHeight = this.renderer.domElement.clientHeight;
      let pr = Utils.projectedRadius(
        1,
        camera,
        distance,
        pixelwidth,
        pixelHeight
      );
      let scale = 10 / pr;
      this.pivotIndicator.scale.set(scale, scale, scale);
    }

    // block z element to not go behind the scene
    if (this.scene.view.position.z < this.minZPosition) {
      this.scene.view.position.z = this.minZPosition;
    }
    // decelerate over time
    {
      this.zoomDelta.multiplyScalar(fade);
      this.wheelDelta = 0;
    }
  }
}
