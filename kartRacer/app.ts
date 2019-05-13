import * as BABYLON from 'babylonjs'
import 'babylonjs-loaders';
import * as GUI from 'babylonjs-gui';

import {KartEngine} from "./engine";


// Create game engine
var kartEngine = new KartEngine();
kartEngine.initializeFullSceenApp();

// Lights and camera
var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 10, 3), kartEngine.scene)
camera.attachControl(kartEngine.canvas, true)
var light = new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), kartEngine.scene)
light.intensity = 0.7

var ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 1000, height: 1000}, kartEngine.scene);

var startingLine = BABYLON.Mesh.CreateBox("start box", 1, kartEngine.scene)
startingLine.position.z = -30
startingLine.position.y = 0;
startingLine.position.x = 5;

var env = kartEngine.scene.createDefaultEnvironment()
env.setMainColor(new BABYLON.Color3(0.1, 0.4,0.6))

kartEngine.scene.createDefaultLight(true)

var uvTexture = new BABYLON.Texture("/public/images/uv.png", kartEngine.scene)

var uvMat = new BABYLON.StandardMaterial("", kartEngine.scene)
uvMat.diffuseTexture = uvTexture
ground.material = uvMat

// Main render loop
kartEngine.scene.onBeforeRenderObservable.add(()=>{

})

var createBillBoardGUI = (startPos : BABYLON.Vector3)=>{
    var root = new BABYLON.Mesh("billboard", kartEngine.scene)
    
    var guiPlane = BABYLON.Mesh.CreatePlane("guiPlane", 6, kartEngine.scene)
    guiPlane.position.set(0,10,10);
    guiPlane.material = new BABYLON.StandardMaterial("",kartEngine.scene)

    var mainMenuGUI = GUI.AdvancedDynamicTexture.CreateForMesh(guiPlane);
    var stackPanel = new GUI.StackPanel();  
    stackPanel.top = "100px";

    mainMenuGUI.addControl(stackPanel);
    mainMenuGUI.background = "white";

    var button1 = GUI.Button.CreateSimpleButton("but1", "Start Game");
    button1.width = 1;
    button1.height = "100px";
    button1.color = "white";
    button1.fontSize = 50;
    button1.background = "green"
    stackPanel.addControl(button1);

    button1.onPointerUpObservable.add(function() {
        var bezierEase = new BABYLON.BezierCurveEase(0.32, 0.73, 0.69, 1.59);
        BABYLON.Animation.CreateAndStartAnimation("moveCamera", camera, "position", 60, 60, camera.position, startingLine.position.add(startPos), BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, bezierEase);

        console.log("click!")
    });

    

    var billBoardBase = BABYLON.Mesh.CreateBox("base", 1, kartEngine.scene)
    billBoardBase.scaling.y = 10;
    billBoardBase.position.set(0,5,10.51)

    return root
}
var startingPosition = new BABYLON.Vector3(0, 3, -30);
var bb = createBillBoardGUI(startingPosition);