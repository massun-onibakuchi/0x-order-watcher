import 'dotenv/config';
import readline from 'readline';
import { ethers, BigNumber } from 'ethers';
import NativeOrdersFeature from '../src/abi/NativeOrdersFeature.json';


const ORDER = JSON.parse("{\"signature\":{\"signatureType\":3,\"r\":\"0xbb48f8574d7bea353bb52db05af198583ff1a9005581f620417cb18f51a97707\",\"s\":\"0x00d8163bf759a39745a32952dff8d0374de02068d29b4460c0dc255dc3f23563\",\"v\":27},\"sender\":\"0x0000000000000000000000000000000000000000\",\"maker\":\"0x3d0ac00867ac7c9ae753c6ae63edf49b4179d3ac\",\"taker\":\"0x0000000000000000000000000000000000000000\",\"takerTokenFeeAmount\":\"0\",\"makerAmount\":\"594000000000000000000\",\"takerAmount\":\"10000000000000000000\",\"makerToken\":\"0x1d7022f5b17d2f8b695918fb48fa1089c9f85401\",\"takerToken\":\"0x0b1ba0af832d7c05fd64161e0db78e85978e8082\",\"salt\":\"1676355693695\",\"verifyingContract\":\"0x1e2f9e10d02a6b8f8f69fcbf515e75039d2ea30d\",\"feeRecipient\":\"0x0000000000000000000000000000000000000000\",\"expiry\":\"1676362893\",\"chainId\":1337,\"pool\":\"0x0000000000000000000000000000000000000000000000000000000000000000\"}")
// function readUserInput(question: string) {
//     const rl = readline.createInterface({
//         input: process.stdin,
//         output: process.stdout
//     });

//     return new Promise((resolve, reject) => {
//         rl.question(question, (answer: any) => {
//             resolve(answer);
//             rl.close();
//         });
//     });
// }

enum OrderStatus {
    INVALID = 0,
    // 約定可能
    FILLABLE = 1,
    // 完全約定済み
    FILLED = 2,
    CANCELLED = 3,
    EXPIRED = 4,
}
const main = async () => {
    const EXCHANGE_PROXY = process.env.EXCHANGE_PROXY
    const RPC_URL = process.env.RPC_URL
    // console.log('EXCHANGE_PROXY :>> ', EXCHANGE_PROXY);
    // console.log('RPC_URL :>> ', RPC_URL);
    if (!EXCHANGE_PROXY || !RPC_URL) {
        throw new Error('Missing env vars');
    }
    const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
    const zeroEx = new ethers.Contract(
        EXCHANGE_PROXY,
        new ethers.utils.Interface(NativeOrdersFeature.abi),
        provider,
    );
    // const order = await readUserInput('Input order JSON >') as any;
    // const { signature, limitOrder } = JSON.parse(order)
    const { signature, ...limitOrder } = ORDER
    const orderStates: {
        orderInfos: {
            orderHash: string;
            status: number;
            takerTokenFilledAmount: BigNumber;
        }[];
        actualFillableTakerTokenAmounts: BigNumber[];
        isSignatureValids: boolean[];
    } = await zeroEx.batchGetLimitOrderRelevantStates([limitOrder], [signature]);

    for (let i = 0; i < orderStates.orderInfos.length; i++) {
        const orderInfo = orderStates.orderInfos[i];
        const actualFillableTakerTokenAmount = orderStates.actualFillableTakerTokenAmounts[i];
        const isSignatureValid = orderStates.isSignatureValids[i];
        console.log(`orderInfo :>> hash: ${orderInfo.orderHash}, status: ${OrderStatus[orderInfo.status]}, takerTokenFilledAmount: ${orderInfo.takerTokenFilledAmount.toString()}`);
        console.log(`actualFillableTakerTokenAmount :>> ${actualFillableTakerTokenAmount.toString()}`);
        console.log(`isSignatureValid :>> ${isSignatureValid}`);
    }
}
main().catch(console.error);