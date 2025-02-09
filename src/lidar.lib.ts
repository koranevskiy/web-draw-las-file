import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/Addons.js';
import {delay} from "./utils.ts";
import Delaunator from 'delaunator'

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
            max: [+headerFixedData.getFloat64(xyzOffset + 8 * 6, true).toFixed(2), +headerFixedData.getFloat64(xyzOffset + 8 * 8, true).toFixed(2), +headerFixedData.getFloat64(xyzOffset + 8 * 10, true).toFixed(2)] as XYZ,
            min: [+headerFixedData.getFloat64(xyzOffset + 8 * 7, true).toFixed(2), +headerFixedData.getFloat64(xyzOffset + 8 * 9, true).toFixed(2), +headerFixedData.getFloat64(xyzOffset + 8 * 11, true).toFixed(2)] as XYZ,
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
        +(xyz[0] * scaleFactorXYZ[0] + offsetXYZ[0]).toFixed(2),
        +(xyz[1] * scaleFactorXYZ[1] + offsetXYZ[1]).toFixed(2),
        +(xyz[2] * scaleFactorXYZ[2] + offsetXYZ[2]).toFixed(2),
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

    for (let i = 0; i < finallyPacketsLength; ++i) {
        const dataView = new DataView(await file.slice(offsetBytesStart, offsetBytesEnd).arrayBuffer())
        const pointBufferLength = (offsetBytesEnd - offsetBytesStart) / size
        const pointsPacket: PointPacket = [];
        for (let j = 0, offset = 0; j < pointBufferLength; ++j, offset += size) {
            const point = parsePointForLas1v2(dataView, scaleFactor, offsetXYZ, size, offset)
            pointsPacket.push(point)
        }
        await delay()
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

    private readonly fov = 75;

    private near = 0.1;

    private far = 5000;

    private hFov = 1;

    private readonly aspectRatio: number;

    constructor(private readonly canvas: HTMLCanvasElement) {
        this.renderer = new THREE.WebGLRenderer({
            canvas
        })
        this.scene = new THREE.Scene();
        this.aspectRatio = canvas.clientWidth / canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(this.fov, this.aspectRatio, this.near, this.far);
        this.setHFov(this.camera.fov)
    }

    private setHFov(vFov: number) {
        const radFov = this.getRadian(vFov);
        this.hFov = 2 * Math.atan(Math.tan(radFov / 2) * this.aspectRatio);

    }

    private getRadian(x: number) {
        return (Math.PI / 180) * x;
    }

    private calculateCameraPosition(min: XYZ, max: XYZ) {
        const height = max[1] - min[1];
        const width = max[0] - min[0];
        const x = max[0] - width / 2;
        const y = max[1] - height / 2;
        const z = max[2];
        const widthZ = 1.1 * Math.abs((width / 2) / Math.tan(this.hFov / 2));
        const heightZ = 1.1 * Math.abs((height / 2) / Math.tan(this.getRadian(this.fov) / 2));
        const newZ = z + Math.max(widthZ, heightZ);
        return {
            x, y, z: newZ
        };
    }

    private setCamera(min: XYZ, max: XYZ) {
        const {x, y, z} = this.calculateCameraPosition(min, max);
        this.camera.position.z = z;
        this.camera.position.x = x;
        this.camera.position.y = y;
        this.orbitControl = new OrbitControls(this.camera, this.canvas);
        this.orbitControl.target.set(x, y, max[2])
        this.orbitControl.update()
    }


    public drawLimitBox(min: XYZ, max: XYZ) {
        const width = (max[0] - min[0]);
        const height = (max[1] - min[1]);
        const depth = (max[2] - min[2]);
        const box = new THREE.BoxGeometry(width, height, depth, width, height, depth);

        const edges = new THREE.EdgesGeometry(box);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color: 0xffffff}));
        line.position.set(max[0] - width / 2, max[1] - height / 2, max[2] - depth / 2);
        this.scene.add(line)

        const color = 0xFFFFFF;
        const intensity = 1;
        const light = new THREE.AmbientLight(color, intensity);
        this.scene.add(light);
        this.setCamera(min, max)

        const animate = () => {
            this.renderer.render(this.scene, this.camera);
            requestAnimationFrame(animate)
        }

        animate()
    }

    public drawPacket(packet: PointPacket) {
        const vertex = new Float32Array(packet.length * 3);
        const colors = new Float32Array(packet.length * 3);
        const triangleCoords = new Float32Array(packet.length * 2);

        for (let i = 0; i < packet.length; i++) {
            const {xyz, rgb} = packet[i]
            vertex[i * 3] = xyz[0]
            triangleCoords[i * 2] = xyz[0]
            vertex[i * 3 + 1] = xyz[1]
            triangleCoords[i * 2 + 1] = xyz[1]
            vertex[i * 3 + 2] = xyz[2]
            colors[i * 3] = rgb[0]// три жс оес хочет нормализованные от 0 до 1
            colors[i * 3 + 1] = rgb[1]
            colors[i * 3 + 2] = rgb[2]
        }
        // const indexDelaunau = Delaunator.from(packet.map(a => [a.xyz[0], a.xyz[1]]));
        const indexDelaunau = new Delaunator(triangleCoords);
        const geom = new THREE.BufferGeometry();

        geom.setAttribute('position', new THREE.BufferAttribute(vertex, 3))
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const idx: number[] = []
        for (let i = 0; i < indexDelaunau.triangles.length; i++) {
            idx.push(indexDelaunau.triangles[i])
        }
        geom.setIndex(idx);
        geom.computeVertexNormals()
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geom, material);

        this.scene.add(mesh)
    }

    // public drawPacket(packet: PointPacket) {
    //     const vertex = new Float32Array(packet.length * 3);
    //     const colors = new Float32Array(packet.length * 3);
    //     const delaunatorCords = new Float32Array(packet.length * 2);
    //
    //     for (let i = 0; i < packet.length; i++) {
    //         const {xyz, rgb} = packet[i]
    //         vertex[i * 3] = xyz[0]
    //         vertex[i * 3 + 1] = xyz[1]
    //         vertex[i * 3 + 2] = xyz[2]
    //         colors[i * 3] = rgb[0]// три жс оес хочет нормализованные от 0 до 1
    //         colors[i * 3 + 1] = rgb[1]
    //         colors[i * 3 + 2] = rgb[2]
    //         delaunatorCords[i * 3] = xyz[0] // x
    //         delaunatorCords[i * 3 + 2] = xyz[2] // z
    //     }
    //
    //     const indexDelaunau = new Delaunator(delaunatorCords);
    //     const meshIndex: number[] = []
    //     for (let i = 0; i < indexDelaunau.triangles.length; i++) {
    //         meshIndex.push(indexDelaunau.triangles[i]);
    //     }
    //     console.log(meshIndex)
    //     const pointsGeometry = new THREE.BufferGeometry();
    //
    //     const pointsMaterial = new THREE.PointsMaterial({vertexColors: true, size: 1});
    //
    //     pointsGeometry.setAttribute('position', new THREE.BufferAttribute(vertex, 3));
    //     pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    //     pointsGeometry.setIndex(meshIndex)
    //     pointsGeometry.computeVertexNormals();
    //
    //     const points = new THREE.Points(pointsGeometry, pointsMaterial);
    //     this.scene.add(points)
    // }

    private minMax(packet: PointPacket) {
        let maxX = packet[0].xyz[0], maxY = packet[0].xyz[1], maxZ = packet[0].xyz[2], minX = packet[0].xyz[0],
            minY = packet[0].xyz[1], minZ = packet[0].xyz[2];

        for (let i = 1; i < packet.length; ++i) {
            if (packet[i].xyz[0] > maxX) {
                maxX = packet[i].xyz[0];
            }
            if (packet[i].xyz[1] > maxY) {
                maxY = packet[i].xyz[1];
            }
            if (packet[i].xyz[2] > maxZ) {
                maxZ = packet[i].xyz[2];
            }

            if (packet[i].xyz[0] < minX) {
                minX = packet[i].xyz[0];
            }

            if (packet[i].xyz[1] < minY) {
                minY = packet[i].xyz[1];
            }

            if (packet[i].xyz[2] < minZ) {
                minZ = packet[i].xyz[2];
            }
        }
        return {
            maxX, maxY, maxZ, minX, minY, minZ
        }
    }

    // public drawPacket(packet: PointPacket) {
    //     const vertex = new Float32Array(packet.length * 3);
    //     const colors = new Float32Array(packet.length * 3);
    //
    //     // Определите минимальные и максимальные значения для координат
    //     // const {minZ, minY, minX, maxZ, maxY, maxX} = this.minMax(packet);
    //     const [minX, minY, minZ] = this.min
    //     const [maxX, maxY, maxZ] = this.max
    //     const quant = 100
    //     for (let i = 0; i < packet.length; i++) {
    //         const {xyz, rgb} = packet[i];
    //
    //         // Применяем smoothstep к координатам
    //         const smoothX = THREE.MathUtils.smoothstep(xyz[0] * quant, minX * quant, maxX * quant) * (maxX - minX) + minX;
    //         const smoothY = THREE.MathUtils.smoothstep(xyz[1] * quant, minY * quant, maxY * quant) * (maxY - minY) + minY;
    //         const smoothZ = THREE.MathUtils.smoothstep(xyz[2] * quant, minZ * quant, maxZ * quant) * (maxZ - minZ) + minZ;
    //         vertex[i * 3] = smoothX;
    //         vertex[i * 3 + 1] = smoothY;
    //         vertex[i * 3 + 2] = smoothZ;
    //
    //         colors[i * 3] = rgb[0]; // три жс оес хочет нормализованные от 0 до 1
    //         colors[i * 3 + 1] = rgb[1];
    //         colors[i * 3 + 2] = rgb[2];
    //     }
    //
    //     const pointsGeometry = new THREE.BufferGeometry();
    //     const pointsMaterial = new THREE.PointsMaterial({vertexColors: true, size: 2});
    //     pointsGeometry.setAttribute('position', new THREE.BufferAttribute(vertex, 3));
    //     pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    //     const points = new THREE.Points(pointsGeometry, pointsMaterial);
    //     this.scene.add(points);
    // }
}