import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/Addons.js';

export const parseHeaderLas1v2 = async (file: File) => {
    const headerSize = new DataView(await file.slice(94, 100).arrayBuffer()).getUint16(0, true);
    const headerFixedData = new DataView(await file.slice(0, headerSize).arrayBuffer())

    const xyzOffset = 131;

    return {
        headerSize,
        offsetToPoints: headerFixedData.getUint32(96, true),
        point: {
            quantity: headerFixedData.getUint32(107, true),
            size: headerFixedData.getUint16(105, true),
            formatId: headerFixedData.getUint8(104)
        },
        xyz: {
            scaleFactor: [headerFixedData.getFloat64(xyzOffset, true), headerFixedData.getFloat64(xyzOffset + 8, true), headerFixedData.getFloat64(xyzOffset + 8 * 2, true)] as XYZ,
            offset: [headerFixedData.getFloat64(xyzOffset + 8 * 3, true), headerFixedData.getFloat64(xyzOffset + 8 * 4, true), headerFixedData.getFloat64(xyzOffset + 8 * 5, true)] as XYZ,
            max: [headerFixedData.getFloat64(xyzOffset + 8 * 6, true), headerFixedData.getFloat64(xyzOffset + 8 * 8, true), headerFixedData.getFloat64(xyzOffset + 8 * 10, true)] as XYZ,
            min: [headerFixedData.getFloat64(xyzOffset + 8 * 7, true), headerFixedData.getFloat64(xyzOffset + 8 * 9, true), headerFixedData.getFloat64(xyzOffset + 8 * 11, true)] as XYZ,
        }
    }
}
type XYZ = [number, number, number];
/**
 *
 * @return [x, y, z]
 * @param xyz
 * @param scaleFactorXYZ
 * @param offsetXYZ
 */
export const unscaleCoordinate = (xyz: XYZ, scaleFactorXYZ: XYZ, offsetXYZ: XYZ) => {
    return [
        xyz[0] * scaleFactorXYZ[0] + offsetXYZ[0],
        xyz[1] * scaleFactorXYZ[1] + offsetXYZ[1],
        xyz[2] * scaleFactorXYZ[2] + offsetXYZ[2],
    ]
}

// для примера поддержка только точек Format Id = 3 // в примере файла точки 3 типа
export const parsePointForLas1v2 = (dataView: DataView,
                                    scaleFactorXYZ: XYZ, offsetXYZ: XYZ,
                                    pointSize: number,
                                    offset = 0) => {
    const xyz = [dataView.getInt32(offset, true), dataView.getInt32(offset + 4, true), dataView.getInt32(offset + 8, true)] as XYZ;
    const colorNormalize = 65535;
    const rgb = [dataView.getUint16(offset + pointSize - 6, true) / colorNormalize, dataView.getUint16(offset + pointSize - 4, true) / colorNormalize, dataView.getUint16(offset + pointSize - 2, true) / colorNormalize];
    return {
        xyz: unscaleCoordinate(xyz, scaleFactorXYZ, offsetXYZ) as XYZ,
        rgb: rgb as XYZ
    }
}

type PointPacket = ReturnType<typeof parsePointForLas1v2>[]
type OnPacketParse = (packet: PointPacket) => void
type HeaderLas1v2 = Awaited<ReturnType<typeof parseHeaderLas1v2>>
export const parsePointsLasFile1v2 = async (file: File, pointPacketLength: number, header: HeaderLas1v2, onPacketParse: OnPacketParse) => {
    const {offsetToPoints, point: {size, quantity}, xyz: {offset: offsetXYZ, scaleFactor}} = header;


    const packetSize = pointPacketLength * size;

    const pointsSize = size * quantity;

    const finallyPacketsLength = Math.floor(pointsSize / packetSize);

    let offsetBytesStart = offsetToPoints;
    let offsetBytesEnd = offsetToPoints + packetSize > pointsSize ? pointsSize : offsetToPoints + packetSize;

    console.log({
        size,
        pointPacketLength,
        packetSize,
        pointsSize,
        quantity,
        finallyPacketsLength
    })

    console.log({offsetBytesStart, offsetBytesEnd})
    console.log('===================================================')
    for (let i = 0; i < finallyPacketsLength; ++i) {
        const dataView = new DataView(await file.slice(offsetBytesStart, offsetBytesEnd).arrayBuffer())
        const pointBufferLength = (offsetBytesEnd - offsetBytesStart) / size
        const pointsPacket: PointPacket = [];
        for (let j = 0, offset = 0; j < pointBufferLength; ++j, offset += size) {
            const point = parsePointForLas1v2(dataView, scaleFactor, offsetXYZ, size, offset)
            pointsPacket.push(point)
        }
        onPacketParse(pointsPacket)

        offsetBytesStart = offsetBytesEnd;
        const incrementOffsetEnd = offsetBytesEnd + packetSize;
        offsetBytesEnd = incrementOffsetEnd > pointsSize ? pointsSize : incrementOffsetEnd;
    }

}

export class LidarDrawer {

    private readonly renderer: THREE.WebGLRenderer;

    private readonly scene: THREE.Scene;

    private readonly camera: THREE.PerspectiveCamera;

    private orbitControl: OrbitControls = null!

    constructor(private readonly canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({
            canvas
        })
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 5000);
    }

    private setCamera(min: XYZ, max: XYZ) {
        const x = max[0] - (max[0] - min[0]) / 2
        const y = max[1] - (max[1] - min[1]) / 2
        this.camera.position.z = max[2] + 300;
        this.camera.position.x = max[0] - (max[0] - min[0]) / 2;
        this.camera.position.y = max[1] - (max[1] - min[1]) / 2;

        this.camera.rotation.x = 0
        this.camera.rotation.y = 0
        this.camera.rotation.z = 0.5
        this.camera.lookAt(x, y, min[2])

        this.orbitControl = new OrbitControls(this.camera, this.canvas);
        this.orbitControl.target.set(x, y, min[2])
        this.orbitControl.update()
    }


    public drawLimitBox(min: XYZ, max: XYZ) {
        const width = (max[0] - min[0]) / 2;
        const height = (max[1] - min[1]) / 2;
        const depth = (max[2] - min[2]) / 2;
        const box = new THREE.BoxGeometry(width, height, depth, width, height, depth);

        const edges = new THREE.EdgesGeometry(box);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color: 0xffffff}));
        line.position.set(max[0] - width, max[1] - height, max[2] - depth);
        this.scene.add(line)

        const color = 0xFFFFFF;
        const intensity = 1;
        const light = new THREE.AmbientLight(color, intensity);
        this.scene.add(light);

        this.setCamera(min, max)
        // this.renderer.render(this.scene, this.camera);

        const animate = () => {
            // this.camera.rotation.y += 0.01
            // this.camera.rotation.x += 0.01
            // this.camera.rotation.z += 0.01
            this.renderer.render(this.scene, this.camera);
            requestAnimationFrame(animate)
        }
        animate()

    }

    public drawPacket(packet: PointPacket) {
        const vertex = new Float32Array(packet.length * 3);
        const colors = new Float32Array(packet.length * 3);
        for (let i = 0; i < packet.length; i++) {
            const {xyz, rgb} = packet[i]
            vertex[i * 3] = xyz[0]
            vertex[i * 3 + 1] = xyz[1]
            vertex[i * 3 + 2] = xyz[2]
            colors[i * 3] = rgb[0]// три жс оес хочет нормализованные от 0 до 1
            colors[i * 3 + 1] = rgb[1]
            colors[i * 3 + 2] = rgb[2]
        }
        const pointsGeometry = new THREE.BufferGeometry();
        const pointsMaterial = new THREE.PointsMaterial({vertexColors: true, size: 2});
        pointsGeometry.setAttribute('position', new THREE.BufferAttribute(vertex, 3));
        pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const points = new THREE.Points(pointsGeometry, pointsMaterial);
        this.scene.add(points)
    }
}