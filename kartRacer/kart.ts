import { IKartInput } from "./input";
import { KartEngine } from "./engine";
import { Engine, Mesh, Scene, Vector3, Ray, Quaternion, FreeCamera, TransformNode, StandardMaterial, Scalar, AbstractMesh, AnimationGroup, ParticleSystem, MeshBuilder, Texture, Color4, Tools, Animation } from "@babylonjs/core";
import { AdvancedDynamicTexture, StackPanel, TextBlock } from "@babylonjs/gui";
import { Menu } from "./menu";

export class Kart extends TransformNode {
    private _mesh: AbstractMesh;
    private _animationGroups?: { wheelsRotation: AnimationGroup, steering: AnimationGroup };
    private _camera: FreeCamera;
    private _input: IKartInput;
    private _hits: number = 0;
    private _particlesLeft: ParticleSystem;
    private _particlesRight: ParticleSystem;
    private _particlesState: ParticleSystem;
    private _particlesConeLeft: Mesh;
    private _particlesConeRight: Mesh;
    private _particlesSphere: Mesh;

    private static readonly UP_GROUNDED_FILTER_STRENGTH: number = 7.0;
    private static readonly UP_FALLING_FILTER_STRENGTH: number = 1.0;
    private static readonly MAX_FALL_TIME_SECONDS: number = 2.0;
    private static readonly TURN_FILTER_STRENGTH: number = 0.1;
    private static readonly MAX_TURN_SCALAR: number = Math.PI * 2 / 3;
    private static readonly FORWARD_VELOCITY_SCALAR: number = 2.0;
    private static readonly VELOCITY_DECAY_SCALAR: number = 2.0;
    private static readonly TURN_DECAY_SCALAR: number = 5.0;
    private static readonly BRAKE_SCALAR: number = 3.0;
    private static readonly SLOW_DURATION: number = 3000;
    private static readonly BOMB_DURATION: number = 2000;
    private static readonly BOOST_DURATION: number = 1000;

    private _velocity: Vector3 = Vector3.Zero();
    private _relocity: number = 0.0;
    private _filteredUp: Vector3 = Vector3.Up();
    private _fallTime: number = 0.0;
    private _deltaTime: number = 0.0;
    private _lastSafePosition: Vector3 = Vector3.Zero();
    private _lastSafeFilteredUp: Vector3 = Vector3.Zero();
    private _turnFactor: number = 0.0;
    private _kartName: string = "";
    private _lastHazardId: number = -1;
    private _lastHazardType: string = "";
    private _bombHitTime: number = 0;
    private _velocityFactor: number = 1;
    private _initialPosition: Vector3;
    private _arrowPosition: Mesh;

    private _initialLookAt: Vector3;
    private _checkpoints: Vector3[];
    private _totalCheckpoints: number = 0;
    private _boostHitTime: number = 0;
    private _slowHitTime: number = 0;
    private _state: string = "ok";

    public TrackTime: string = "";
    public PlayerMenu: Menu;

    constructor(kartName: string, scene: Scene, locallyOwned: boolean = true) {
        super(kartName, scene);

        if (locallyOwned) {
            this._input = KartEngine.instance.inputSource;
            const mainKartInfo = KartEngine.instance.assets.mainKartInfo;
            this._animationGroups = mainKartInfo.animationGroups;
            // this._animationGroups.wheelsRotation.play(true);
            // this._animationGroups.wheelsRotation.speedRatio = 0;
            this._animationGroups.steering.play(true);
            this._animationGroups.steering.pause();
            this._mesh = mainKartInfo.mesh;
            this._mesh.name = "model";
            this._mesh.parent = this;
        }
        else {
            this._mesh = KartEngine.instance.assets.kart.createInstance("model");
            this._mesh.scaling.scaleInPlace(0.05);
            this._mesh.isPickable = false;
            this._mesh.parent = this;
        }

        this.setUpParticleSystems(scene);
    }

    public activateKartCamera(): FreeCamera {
        this.setup3rdPersonKartCamera();

        this._scene.registerBeforeRender(() => {
            this.beforeRenderUpdate();
        });

        this._arrowPosition = this.createCheckpointArrow();

        return this._camera;
    }

    public assignKartName(name: string): void {
        var namePlane = Mesh.CreatePlane("namePlane", 3.5, this._scene);
        namePlane.material = new StandardMaterial("", this._scene)

        var nameMesh = AdvancedDynamicTexture.CreateForMesh(namePlane);
        var stackPanel = new StackPanel();
        stackPanel.height = "100%";
        nameMesh.addControl(stackPanel);

        var nameText = new TextBlock();
        nameText.height = "100%";
        nameText.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_TOP;
        nameText.fontSize = 96;
        nameText.color = "white"
        nameText.text = name;
        nameText.textWrapping = true;
        nameText.outlineColor = "black";
        nameText.outlineWidth = 3;
        stackPanel.addControl(nameText);
        namePlane.position.set(0, 1, 0);
        namePlane.parent = this;

        this._kartName = name;
    }

    public initializeTrackProgress(checkpoints: Vector3[], startingPosition: Vector3, startingLookAt: Vector3): void {
        this._initialPosition = startingPosition;
        this._initialLookAt = startingLookAt;
        this._checkpoints = checkpoints;
        // checkpoints.forEach((c)=>{
        //     var s = Mesh.CreateSphere("", 16, 40)
        //     s.position.copyFrom(c)
        // })
        this._totalCheckpoints = checkpoints.length;
    }

    public getTrackComplete(): number {
        return Math.round(this._hits / this._totalCheckpoints * 100);
    }

    public getKartName(): string {
        return this._kartName;
    }

    private createCheckpointArrow(): Mesh {
        var arrowshaft = Mesh.CreateBox("arrowshaft",1,this._scene);
        arrowshaft.scaling.y = 1.75;
        arrowshaft.position.y = 1.25;
        var arrowpoint = Mesh.CreateCylinder("arrowpoint", 1, 1, 1, 3, this._scene);
        arrowpoint.rotate(new Vector3(0,0,1),0.5 * Math.PI)
        arrowpoint.rotate(new Vector3(0,1,1),Math.PI)
        arrowpoint.scaling = new Vector3(1,1,2);
        arrowpoint.position.y = -0.75
        arrowpoint.parent = arrowshaft;

        arrowpoint.isPickable = false;
        arrowshaft.isPickable = false;
        Animation.CreateAndStartAnimation("rotateArrow",arrowshaft,"rotation",60,120,arrowpoint.rotation, new Vector3(0,Math.PI,0),Animation.ANIMATIONLOOPMODE_CYCLE)
        
        return arrowshaft;
    }

    private updateFromPhysics(): void {
        var ray = new Ray(this.position, this.up.scale(-1.0), 0.7);
        var hit = KartEngine.instance.scene.pickWithRay(ray);
        if (hit.hit) {
            // MAGIC: There is a bug in the picking code where the barycentric coordinates
            // returned for bu and bv are actually bv and bw.  This causes the normals to be
            // calculated incorrectly.
            const bv = hit.bu;
            const bw = hit.bv;
            const bu = 1.0 - bv - bw;
            hit.bu = bu;
            hit.bv = bv;

            var normal = hit.getNormal(true, true);

            this._filteredUp = Vector3.Lerp(
                this._filteredUp,
                normal,
                Kart.UP_GROUNDED_FILTER_STRENGTH * this._deltaTime);
            this._filteredUp.normalize();

            this.position = hit.pickedPoint.add(this._filteredUp.scale(0.55));

            this._velocity.subtractInPlace(normal.scale(Vector3.Dot(this._velocity, normal)));

            this._fallTime = 0.0;
            this._lastSafePosition.copyFrom(this.position);
            this._lastSafeFilteredUp.copyFrom(this._filteredUp);
        }
        else {
            this._filteredUp = Vector3.Lerp(
                this._filteredUp,
                Vector3.Up(),
                Kart.UP_FALLING_FILTER_STRENGTH * this._deltaTime);
            this._filteredUp.normalize();

            this._velocity.addInPlace(Vector3.Down().scale(this._deltaTime));

            this._fallTime += this._deltaTime;
            if (this._fallTime > Kart.MAX_FALL_TIME_SECONDS) {
                this.position.copyFrom(this._lastSafePosition);
                this._filteredUp.copyFrom(this._lastSafeFilteredUp);
                this._velocity.set(0.0, 0.0, 0.0);
                this._relocity = 0.0;
            }
        }

        var forward = Vector3.Cross(this.right, this._filteredUp);
        var right = Vector3.Cross(this._filteredUp, forward);
        this.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(right, this._filteredUp, forward);
    }

    private checkHazardCollision(name: string): number {
        const radiusCollision = 2;

        const hazards = (KartEngine.instance.scene as any).getTransformNodeByName(name);

        if (hazards == null) {
            return -1;
        }

        const bombs = hazards.getChildMeshes();

        for (var index = 0; index < bombs.length; ++index) {
            const position = bombs[index].position;
            const distance = this.position.subtract(position).length();
            if (distance < radiusCollision) {
                return index;
            }
        }

        return -1;
    }

    private updateFromHazards(): void {
        let collisionId = this.checkHazardCollision("bombs");
        if (collisionId != -1 && (collisionId != this._lastHazardId || this._lastHazardType != "bomb")) {
            this._velocity.set(0.0, 1.2, 0.0);
            this._lastHazardId = collisionId;
            this._lastHazardType = "bomb";
            this._bombHitTime = (new Date).getTime();
            this._velocityFactor = 0.5;
            this._state = "exploded";
        }

        collisionId = this.checkHazardCollision("boosts");
        if (collisionId != -1 && (collisionId != this._lastHazardId || this._lastHazardType != "boost")) {
            this._lastHazardId = collisionId;
            this._lastHazardType = "boost";
            this._boostHitTime = (new Date).getTime();
            this._velocityFactor = 1.6;
            this._state = "fast";
        }

        collisionId = this.checkHazardCollision("bumpers");
        if (collisionId != -1) {
            const hazards = (KartEngine.instance.scene as any).getTransformNodeByName("bumpers");
            const bumpers = hazards.getChildMeshes();
            const bumper = bumpers[collisionId];
            const bumperPosition = bumper.position;
            let direction = this.position.subtract(bumperPosition);
            direction.y = 0;
            direction.normalize();

            const angle = Vector3.GetAngleBetweenVectors(this._velocity, direction, new Vector3(0, 1, 0));
            if (angle > 2 * Math.PI / 3.0 && angle < 4 * Math.PI / 3.0) {
                this._velocity.set(-this._velocity.x, this._velocity.y, -this._velocity.z);
            }
            else {
                const speed = Math.max(this._velocity.length() * .8, 0.3);

                direction.scaleInPlace(this._velocity.length() * 2);
                this._velocity.addInPlace(direction);
                this._velocity.normalize();
                this._velocity.scaleInPlace(speed);
            }

            this._lastHazardId = collisionId;
            this._lastHazardType = "bumper";
        }
        collisionId = this.checkHazardCollision("poison");
        if (collisionId != -1 && (collisionId != this._lastHazardId || this._lastHazardType != "poison")) {
            this._velocity.set(0.0, 0.0, 0.0);
            this._lastHazardId = collisionId;
            this._lastHazardType = "poison";
            this._slowHitTime = (new Date).getTime();
            this._velocityFactor = 0.1;
            this._state = "slow";
        }
    }

    private getForward(): number {
        //return false ? 1.0 : 0.0;
        return Math.max(0, Math.min(1, this._input.accelerate));
    }

    private getLeft(): number {
        //return false ? 1.0 : 0.0;
        return Math.max(0, Math.min(1, -this._input.horizontal));
    }

    private getBack(): number {
        //return false ? 1.0 : 0.0;
        return Math.max(0, Math.min(1, -this._input.accelerate));
    }

    private getRight(): number {
        //return false ? 1.0 : 0.0;
        return Math.max(0, Math.min(1, this._input.horizontal));
    }

    private getBrake(): number {
        //return false ? 1.0 : 0.0;
        return Math.max(0, Math.min(1, this._input.brake));
    }

    private updateFromControls(): void {
        this._turnFactor = Kart.TURN_FILTER_STRENGTH * this.getLeft();
        this._relocity = this._turnFactor * -Kart.MAX_TURN_SCALAR * this._deltaTime + (1.0 - this._turnFactor) * this._relocity;

        this._turnFactor = Kart.TURN_FILTER_STRENGTH * this.getRight();
        this._relocity = this._turnFactor * Kart.MAX_TURN_SCALAR * this._deltaTime + (1.0 - this._turnFactor) * this._relocity;

        this.rotateAround(this.position, this.up, this._relocity);

        KartEngine.instance.assets.engineSound.setVolume(Scalar.Lerp(KartEngine.instance.assets.engineSound.getVolume(), this.getForward(), 0.1))
        this._velocity.addInPlace(this.forward.scale(this.getForward() * Kart.FORWARD_VELOCITY_SCALAR * this._velocityFactor * this._deltaTime));

        this._velocity.subtractInPlace(this.forward.scale(this.getBack() * this._deltaTime));

        this._velocity.scaleInPlace(1.0 - (this.getBrake() * Kart.BRAKE_SCALAR * this._deltaTime));

        if (this._animationGroups) {
            // const wheelsRotation = this._animationGroups.wheelsRotation;
            // wheelsRotation.speedRatio = this._velocity.length();

            const steering = this._animationGroups.steering;
            steering.goToFrame((this._input.horizontal + 1) * 0.5 * steering.to);
        }
    }

    private updateFromTrackProgress(): void {
        let i = 0
        let hit = false;
        let kartPos = this.position;

        let diff = kartPos.subtract(this._checkpoints[this._hits])

        if (diff.length() < 20) {
            this._hits++;
            if(this._hits < this._checkpoints.length)
            {
                this._arrowPosition.position = this._checkpoints[this._hits].add(new Vector3(0,10,0));
            }
        }
    }

    private beforeRenderUpdate(): void {
        this._deltaTime = Engine.Instances[0].getDeltaTime() / 1000.0;
        if (this._deltaTime > 0.3) {
            return;
        }

        if ((this._state == "exploded" && (new Date).getTime() - this._bombHitTime > Kart.BOMB_DURATION)
            || (this._state == "fast" && (new Date).getTime() - this._boostHitTime > Kart.BOOST_DURATION)
            || (this._state == "slow" && (new Date).getTime() - this._slowHitTime > Kart.SLOW_DURATION)) {
            this._velocityFactor = 1;
            this._state = "ok";
        }

        if (this._hits < this._checkpoints.length) {
            this.updateFromTrackProgress();
        }

        this.updateFromPhysics();
        this.updateFromHazards();

        if (this._state != "exploded") {
            this.updateFromControls();
        }

        this._velocity.scaleInPlace(1.0 - (Kart.VELOCITY_DECAY_SCALAR * this._deltaTime));
        this._relocity *= (1.0 - (Kart.TURN_DECAY_SCALAR * this._deltaTime));

        this.position.addInPlace(this._velocity.scale(this._deltaTime * 60));

        this.updateParticles(this._velocity.length());
    }

    private setup3rdPersonKartCamera() {
        this._camera = new FreeCamera(this.name + "_camera", new Vector3(0, 4, -8), this.getScene());
        this._camera.setTarget(this.position.add(this.forward.scale(10.0)));
        this._camera.parent = this;
        this.getScene().activeCamera = this._camera;
    }

    private setUpParticleSystems(scene: Scene) {
        const scaling = this.scaling;
        this._particlesLeft = this.setUpSpeedParticles(scene, this._particlesConeLeft, new Vector3(-scaling.x, 0.5, 2 * scaling.z), new Vector3(-scaling.x, 0.0, 0))
        this._particlesRight = this.setUpSpeedParticles(scene, this._particlesConeRight, new Vector3(scaling.x, 0.5, 2 * scaling.z), new Vector3(scaling.x, 0.0, 0))
        this._particlesSphere = MeshBuilder.CreateSphere("sphere", {diameter:scaling.x * 2, segments: 8}, scene);
        this._particlesSphere.position= this.position
        this._particlesSphere.parent = this;
        this._particlesSphere.material = new StandardMaterial("mat", scene);
        this._particlesSphere.visibility = 0;
        this._particlesSphere.isPickable = false;

        this._particlesState= new ParticleSystem("particles", 2000, scene);
        this._particlesState.particleTexture = new Texture("/public/textures/flare.png", scene);
        this._particlesState.emitter = this._particlesSphere; 
        this._particlesState.createSphereEmitter(scaling.x);
        this._particlesState.colorDead = new Color4(0, 0.0, 0.0, 0.0);
        this._particlesState.minSize = 0.3;
        this._particlesState.maxSize = 0.5;
        this._particlesState.minLifeTime = 2;
        this._particlesState.maxLifeTime = 5;
        this._particlesState.emitRate = 500;
        this._particlesState.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        this._particlesState.minEmitPower = 1;
        this._particlesState.maxEmitPower = 2;
        this._particlesState.updateSpeed = 0.08;        
        this._particlesState.start();
    
    }

    private setUpSpeedParticles(scene: Scene, cone: Mesh, minEmitBox: Vector3, maxEmitBox: Vector3): ParticleSystem {
        cone = MeshBuilder.CreateCylinder("cone", { diameterBottom: 0, diameterTop: 1, height: 1 }, scene);
        cone.position = this.position.subtract(new Vector3(0, 0, 1.5));
        // cone.rotate(new Vector3(1,0,0), -Math.PI/2.0);
        cone.parent = this;
        cone.material = new StandardMaterial("mat", scene);
        cone.visibility = 0;

        const particlesSystem = new ParticleSystem("particles", 2000, scene);
        particlesSystem.particleTexture = new Texture("/public/textures/flare.png", scene);
        particlesSystem.emitter = cone;
        particlesSystem.minEmitBox = minEmitBox;
        particlesSystem.maxEmitBox = maxEmitBox;

        particlesSystem.colorDead = new Color4(0, 0.0, 0.0, 0.0);
        particlesSystem.minSize = 0.1;
        particlesSystem.maxSize = 0.15;
        particlesSystem.minLifeTime = 0.02;
        particlesSystem.maxLifeTime = 0.05;
        particlesSystem.emitRate = 500;
        particlesSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        particlesSystem.direction1 = new Vector3(0, 0, -1);
        particlesSystem.direction2 = new Vector3(0, 1, -1);
        particlesSystem.minAngularSpeed = 0;
        particlesSystem.maxAngularSpeed = Math.PI / 8;
        particlesSystem.minEmitPower = 0.5;
        particlesSystem.maxEmitPower = 1;
        particlesSystem.updateSpeed = 0.08;

        particlesSystem.start();

        return particlesSystem;
    }

    private updateSpeedParticle(speed: number) {
        this._particlesLeft.emitRate = speed * 100;
        this._particlesRight.emitRate = speed * 100;


        if (speed > 0 && speed < .7) {
            const gray1 = new Color4(0.3, 0.3, 0.3, 1.0);
            const gray2 = new Color4(0.7, 0.7, 0.7, 1.0);
            this._particlesLeft.color1 = gray1;
            this._particlesLeft.color2 = gray2;
            this._particlesLeft.maxLifeTime = 2;
            this._particlesRight.color1 = gray1;
            this._particlesRight.color2 = gray2;
            this._particlesRight.maxLifeTime = 2;
        }

        else if (speed >= .7 && speed < 1.3) {
            const yellow1 = new Color4(1, 1, 0.0, 1.0);
            const yellow2 = new Color4(1, 0.8, 0.0, 1.0);
            this._particlesLeft.color1 = yellow1;
            this._particlesLeft.color2 = yellow2;
            this._particlesLeft.maxLifeTime = .5;
            this._particlesRight.color1 = yellow1;
            this._particlesRight.color2 = yellow2;
            this._particlesRight.maxLifeTime = .5;
        }

        else if (speed >= 1.3 && speed < 1.5) {
            const red1 = new Color4(1, 0, 0.0, 1.0);
            const red2 = new Color4(.7, 0.0, 0.0, 1.0);
            this._particlesLeft.color1 = red1;
            this._particlesLeft.color2 = red2;
            this._particlesLeft.maxLifeTime = .4;
            this._particlesRight.color1 = red1;
            this._particlesRight.color2 = red2;
            this._particlesRight.maxLifeTime = .4;
        }

        else {
            const blue1 = new Color4(0, 1, 0.0, 1.0);
            const blue2 = new Color4(0, 0.8, 0.0, 1.0);
            this._particlesLeft.color1 = blue1;
            this._particlesLeft.color2 = blue2;
            this._particlesLeft.maxLifeTime = .4;
            this._particlesRight.color1 = blue1;
            this._particlesRight.color2 = blue2;
            this._particlesRight.maxLifeTime = .4;
        }
    }

    private updateParticles(speed: number) {
        this.updateSpeedParticle(speed);

        if (this._state == "slow")
        {
            this._particlesState.color1 = new Color4(.6, 0, .9, 1);
            this._particlesState.color2 = new Color4(.5, 0, .8, 1);
            this._particlesState.emitRate = 500;
        }

        else if (this._state == "exploded")
        {
            this._particlesState.color1 = new Color4(0.5, 0.5, 0.5, 1);
            this._particlesState.color2 = new Color4(0.8, 0, 0, 1);
            this._particlesState.emitRate = 500;
        }

        else if (this._state == "fast")
        {
            this._particlesState.color1 = new Color4(0.0, 0, .8, 1);
            this._particlesState.color2 = new Color4(0.0, .8, 0, 1);
            this._particlesState.emitRate = 500;
        }

        else
        {
            this._particlesState.emitRate = 0;
        }
    }


    public reset() {
        this._hits = 0;
        this._state = "ok";
        this._velocity.set(0, 0, 0);
        this._velocityFactor = 1;
        this.position = this._initialPosition;
        this.lookAt(this._initialLookAt);
        this.computeWorldMatrix();
        this.PlayerMenu.SetWinText("");
    }
}
