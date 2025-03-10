import { useRef, useState} from "react";
import {LidarDrawer, parseHeaderLas1v2, parsePointsLasFile1v2} from "./lidar.lib.ts";

function App() {
    const [file, setFile] = useState<File | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);


    const onUploadClickHandler = async () => {
        if (!file) return alert('Please select a LAS file.');
        const header = await parseHeaderLas1v2(file);
        const PACKET_SIZE = 1_000_000;
        // const PACKET_SIZE = Math.floor(48632279 / 3) + 1;
        const drawer = new LidarDrawer(canvasRef.current!);
        drawer.drawLimitBox(header.xyz.minNormalized, header.xyz.maxNormalized);
        console.log(header)

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
            <canvas ref={canvasRef} width='1000px' height='1000px'></canvas>
        </div>
    );
}

export default App;