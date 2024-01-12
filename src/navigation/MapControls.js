/**
 * @author mschuetz / http://mschuetz.at
 *
 * adapted from THREE.OrbitControls by
 *
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 *
 *
 *
 */

import * as THREE from "../../libs/three.js/build/three.module.js";
import {MOUSE} from "../defines.js";
import {Utils} from "../utils.js";
import {EventDispatcher} from "../EventDispatcher.js";


export class MapControls extends EventDispatcher {
	constructor (viewer) {
		super();

    this.viewer = viewer;
    this.renderer = viewer.renderer;

    this.scene = null;
    this.sceneControls = new THREE.Scene();

    this.rotationSpeed = 200;
    this.moveSpeed = 10;
    this.lockElevation = false;

    this.tweens = [];

    let previousTouch = null;

    this.keys = {
      CMD: [91, 224],
      CTRL: [17]
    };

    this.fadeFactor = 50;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.translationDelta = new THREE.Vector3(0, 0, 0);
    this.translationWorldDelta = new THREE.Vector3(0, 0, 0);
    this.panDelta = new THREE.Vector2(0, 0);

    this.isDrag = false;

    let drag = (e) => {
      if (e.drag.object !== null) {
        return;
      }

      if (e.drag.startHandled === undefined) {
        e.drag.startHandled = true;

        this.isDrag = true;
        this.dispatchEvent({ type: 'start' });
      }

      // accelerate while input is given
      let ih = this.viewer.inputHandler;

      let controlDown = this.keys.CTRL.some((e) => ih.pressedKeys[e]);
      let cmdDown = this.keys.CMD.some((e) => ih.pressedKeys[e]);

      let moveSpeed = this.viewer.getMoveSpeed();

      let ndrag = {
        x: e.drag.lastDrag.x / this.renderer.domElement.clientWidth,
        y: e.drag.lastDrag.y / this.renderer.domElement.clientHeight
      };

      if (controlDown || cmdDown) {
        if (e.drag.mouse === MOUSE.LEFT) {
          this.yawDelta += ndrag.x * this.rotationSpeed;
          this.pitchDelta += ndrag.y * this.rotationSpeed;
        }
      } else {
        if (e.drag.mouse === MOUSE.LEFT) {
          this.translationDelta.x -= ndrag.x * moveSpeed * 50;
          this.translationDelta.y += ndrag.y * 0.6 * moveSpeed * 50;
          this.translationDelta.z += ndrag.y * moveSpeed * 50;
        }
      }
    };

    let scroll = (e) => {
      let speed = this.viewer.getMoveSpeed();

      if (e.delta < 0) {
        speed = speed * 0.9;
      } else if (e.delta > 0) {
        speed = speed / 0.9;
      }

      speed = Math.max(speed, 0.1);

      if (e.delta < 0) {
        this.translationDelta.y = speed;
      } else if (e.delta > 0) {
        this.translationDelta.y = -speed;
      }
    };

    let drop = () => {
      setTimeout(() => {
        this.isDrag = false;
      }, 50);
      this.dispatchEvent({ type: 'end' });
    };

    let touchStart = e => {
			previousTouch = e;
		};

		let touchEnd = e => {
			previousTouch = e;
		};

		let touchMove = e => {
			if (e.touches.length === 2 && previousTouch.touches.length === 2){
				let prev = previousTouch;
				let curr = e;

				let prevDX = prev.touches[0].pageX - prev.touches[1].pageX;
				let prevDY = prev.touches[0].pageY - prev.touches[1].pageY;
				let prevDist = Math.sqrt(prevDX * prevDX + prevDY * prevDY);


				let currDX = curr.touches[0].pageX - curr.touches[1].pageX;
				let currDY = curr.touches[0].pageY - curr.touches[1].pageY;
				let currDist = Math.sqrt(currDX * currDX + currDY * currDY);


				let delta = currDist / prevDist;

        if (delta > 1) {
          delta = Math.max(delta, 0.1);
          this.translationDelta.y = delta * 1000;
        } else if (delta < 1) {
          delta = Math.max(delta, 0.1);
          this.translationDelta.y =- delta * 1000;
        }

				this.stopTweens();
			} else if (e.touches.length === 3 && previousTouch.touches.length === 3) {

      }

			previousTouch = e;
		};

    this.addEventListener('drag', drag);
    this.addEventListener('drop', drop);
    this.addEventListener('mousewheel', scroll);
    this.addEventListener('touchstart', touchStart);
		this.addEventListener('touchend', touchEnd);
		this.addEventListener('touchmove', touchMove);
	}

	setScene (scene) {
		this.scene = scene;
	}

  stopTweens () {
		this.tweens.forEach(e => e.stop());
		this.tweens = [];
	}

	stop(){
		this.yawDelta = 0;
		this.pitchDelta = 0;
		this.translationDelta.set(0, 0, 0);
    this.panDelta.set(0, 0);
	}
	
	zoomToLocation(mouse){
		if (!this.isDrag) {
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
                this.scene.view.position.z = (1 - t) * startPos.z + t * targetPos.z;
      
                this.scene.view.radius = (1 - t) * startRadius + t * targetRadius;
                this.viewer.setMoveSpeed(this.scene.view.radius / 2.5);
              });
      
              tween.onComplete(() => {
                this.tweens = this.tweens.filter((e) => e !== tween);
              });
      
              tween.start();
            }
          }
	}

	update(delta) {
        let view = this.scene.view;
    
        {
          // cancel move animations on user input
          let changes = [
            this.yawDelta,
            this.pitchDelta,
            this.translationDelta.length(),
            this.translationWorldDelta.length()
          ];
          let changeHappens = changes.some((e) => Math.abs(e) > 0.001);
          if (changeHappens && this.tweens.length > 0) {
            this.tweens.forEach((e) => e.stop());
            this.tweens = [];
          }
        }

        { // apply pan
          let progression = Math.min(1, this.fadeFactor * delta);
          let panDistance = progression * view.radius * 3;
    
          let px = -this.panDelta.x * panDistance;
          let py = this.panDelta.y * panDistance;
    
          view.pan(px, py);
        }
    
        {
          // apply rotation
          let yaw = view.yaw;
          let pitch = view.pitch;
    
          yaw -= this.yawDelta * delta;
          pitch -= this.pitchDelta * delta;
    
          view.yaw = yaw;
          view.pitch = pitch;
        }
    
        {
          // apply translation
          view.translate(
            this.translationDelta.x * delta,
            this.translationDelta.y * delta,
            this.translationDelta.z * delta
          );
    
          view.translateWorld(
            this.translationWorldDelta.x * delta,
            this.translationWorldDelta.y * delta,
            this.translationWorldDelta.z * delta
          );
        }
    
        {
          // decelerate over time
          let progression = Math.min(1, this.fadeFactor * delta);
			    let attenuation = Math.max(0, 1 - this.fadeFactor * delta);

          this.yawDelta *= attenuation;
          this.pitchDelta *= attenuation;
          this.panDelta.multiplyScalar(attenuation);

          this.translationDelta.multiplyScalar(attenuation);
          this.translationWorldDelta.multiplyScalar(attenuation);
        }
      }
};
