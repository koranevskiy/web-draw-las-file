import { useRef, useState} from "react";
import {LidarDrawer, parseHeaderLas1v2, parsePointsLasFile1v2} from "./lidar.lib.ts";

function App() {
    const [file, setFile] = useState<File | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);


    const onUploadClickHandler = async () => {
        if (!file) return alert('Please select a LAS file.');
        const header = await parseHeaderLas1v2(file);
        const PACKET_SIZE = 100_000;
        const drawer = new LidarDrawer(canvasRef.current!);
        drawer.drawLimitBox(header.xyz.min, header.xyz.max);
        await parsePointsLasFile1v2(file, PACKET_SIZE, header, (packet) => {
            drawer.drawPacket(packet);
        })
        console.log('All points processed.');
    };

    return (
        <div className="p-4">
            <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept=".las"
            />
            <button onClick={onUploadClickHandler}>Load LAS File</button>
            <canvas ref={canvasRef} width='800px' height='800px'></canvas>
        </div>
    );
}

export default App;