import { SuiClient } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from "@mysten/sui/transactions";
import * as dotenv from 'dotenv';

const SUI_RPC_URL = 'https://fullnode.mainnet.sui.io/';

async function getOwnedTokens(client: SuiClient, address: string): Promise<string[]> {
    try {
        const allBalances = await client.getAllBalances({ owner: address });
        
        // Process each balance into TokenInfo
        const tokenInfos = allBalances.map(balance => balance.coinType);

        return tokenInfos;
    } catch (error) {
        console.error(`Error fetching tokens for address ${address}:`, error);
        return [];
    }
}

async function getAllTokenObjectIds(client: SuiClient, address: string, tokenAddress: string): Promise<string[]> {
    try {
        let allCoins: string[] = [];
        let cursor: string | null = null;
        let hasMore = true;

        while (hasMore) {
            const { data, hasNextPage, nextCursor } = await client.getCoins({
                owner: address,
                coinType: tokenAddress,
                cursor: cursor,
                limit: 50, // Max limit per request
            });

            allCoins = [...allCoins, ...data.map(coin => coin.coinObjectId)];
            if (allCoins.length >= 5000) {
                console.log(`Fetched ${allCoins.length} coins, stopping to avoid excessive load.`);
                break; // Stop if we have fetched enough coins
            }
            hasMore = hasNextPage;
            cursor = nextCursor ?? null;
        }

        return allCoins;
    } catch (error) {
        console.error(`Error fetching coin object IDs for address ${address}:`, error);
        return [];
    }
}

export async function mergeCoinObjects(
    privateKey: string,
    tokenAddress: string,
    batchSize: number = 500,
    rpcUrl: string = SUI_RPC_URL
): Promise<void> {
    try {
        // 初始化客户端和密钥对
        const client = new SuiClient({ url: rpcUrl });
        const keyPair = Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
        const address = keyPair.toSuiAddress();

        // 获取所有代币对象
        const tokenObjectIds = await getAllTokenObjectIds(client, address, tokenAddress);
        
        if (tokenObjectIds.length <= 1) {
            console.log('No coins need to be merged');
            return;
        }

        console.log(`Found ${tokenObjectIds.length} objects for token ${tokenAddress}`);
        if (tokenObjectIds.length <= 1) {
            console.log('Less than 2 coins, no need to merge');
            return;
        }

        // 分批处理
        for (let i = 0; i < tokenObjectIds.length; i += batchSize) {
            const batch = tokenObjectIds.slice(i, Math.min(i + batchSize, tokenObjectIds.length));
            
            if (batch.length > 1) {
                const txb = new Transaction();
                
                // 使用第一个对象作为主要合并目标
                let primaryCoin = txb.object(batch[0]);
                
                // 合并其余的代币对象
                for (let j = 1; j < batch.length; j++) {
                    txb.mergeCoins(primaryCoin, [txb.object(batch[j])]);
                }

                // 执行交易
                const result = await client.signAndExecuteTransaction({
                    transaction: txb,
                    signer: keyPair,
                    options: {
                        showEffects: true,
                        showEvents: true
                    }
                });
                console.log(`Batch ${i/batchSize + 1} merged successfully:`, result.digest);
                
                // 等待一小段时间再处理下一批
                if (i + batchSize < tokenObjectIds.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        console.log('All coin objects merged successfully');

    } catch (error) {
        console.error('Error merging coins:', error);
        throw error;
    }
}

async function main() {
    // 加载环境变量
    dotenv.config();

    const suiPrivateKey = process.env.MERGE_COIN_PRIVATE_KEY!;
    // const tokenAddress = "0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX";
    const privateKey = Buffer.from(decodeSuiPrivateKey(suiPrivateKey).secretKey).toString('hex');

    const keyPair = Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
    const userAddress = keyPair.toSuiAddress();

    const client = new SuiClient({ url: SUI_RPC_URL });

    const ownedTokens = await getOwnedTokens(client, userAddress);
    if (ownedTokens.length === 0) {
        console.log('No owned tokens found');
        return;
    }

    console.log(`Found ${ownedTokens.length} owned tokens for address ${userAddress}`);

    for (const token of ownedTokens) {
        console.log(`Token Address: ${token}`);
        await mergeCoinObjects(
            privateKey,
            token,
            500  // 每批处理500个对象
        );
    }
}

main().catch(console.error);