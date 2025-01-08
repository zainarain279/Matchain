const axios = require('axios');
const https = require('https');
const { parse } = require('querystring');
const fs = require('fs');
const ethers = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');

const headers = {
    "host": "tgapp-api.matchain.io",
    "connection": "keep-alive",
    "accept": "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0 (Linux; Android 10; Redmi 4A / 5A Build/QQ3A.200805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.185 Mobile Safari/537.36",
    "content-type": "application/json",
    "origin": "https://tgapp.matchain.io",
    "x-requested-with": "tw.nekomimi.nekogram",
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    "referer": "https://tgapp.matchain.io/",
    "accept-language": "en,en-US;q=0.9"
};

class MatChainNFTClaimer {
    constructor() {
        this.headers = { ...headers };
        this.provider = new ethers.JsonRpcProvider('https://rpc.matchain.io');
        this.nftContractAddress = '0xBc16d08e5bc6Eb8930f7CA5aa1CC6FCa6e2BFd44';
        this.nftContractABI = [
            {
                "inputs": [
                    {
                        "internalType": "address",
                        "name": "nft",
                        "type": "address"
                    },
                    {
                        "internalType": "uint256",
                        "name": "deadline",
                        "type": "uint256"
                    },
                    {
                        "internalType": "address", 
                        "name": "verifier",
                        "type": "address"
                    },
                    {
                        "internalType": "bytes",
                        "name": "signature",
                        "type": "bytes"
                    }
                ],
                "name": "mintWithVerifierSignature",
                "outputs": [
                    {
                        "internalType": "bytes32",
                        "name": "",
                        "type": "bytes32"
                    },
                    {
                        "internalType": "uint256",
                        "name": "",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];
        this.currentProxy = null;
    }

    cleanString(str) {
        return str.replace(/[\r\n]+/g, '').trim();
    }

    readAndCleanFile(filepath) {
        return fs.readFileSync(filepath, 'utf-8')
            .split(/\r?\n/)
            .map(line => this.cleanString(line))
            .filter(line => line.length > 0);
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error when checking proxy IP: ${error.message}`);
        }
    }

    async http(url, headers, data = null) {
        const config = {
            headers,
            httpsAgent: this.currentProxy ? new HttpsProxyAgent(this.currentProxy) : new https.Agent({
                rejectUnauthorized: false
            })
        };

        try {
            const res = data ? 
                await axios.post(url, data, config) : 
                await axios.get(url, config);
            return res;
        } catch (error) {
            console.error(`HTTP request error: ${error.message}`);
            throw error;
        }
    }

    async login(tg_login_params) {
        try {
            const cleanedParams = this.cleanString(tg_login_params);
            
            const params = new URLSearchParams(cleanedParams);
            const userEncoded = params.get('user');
            const user = JSON.parse(decodeURIComponent(userEncoded));

            const url = "https://tgapp-api.matchain.io/api/tgapp/v1/user/login";
            const payload = {
                uid: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                username: user.username,
                tg_login_params: cleanedParams
            };
            
            let res = await this.http(url, this.headers, JSON.stringify(payload));
            if (res.status !== 200 || !res.data?.data?.token) {
                console.log(res.data);
                console.error('Login failed or token not found');
                return null;
            }

            const token = res.data.data.token;
            console.log('Login successful');
            
            const balanceUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/point/balance";
            const balanceHeaders = { ...this.headers, authorization: token };
            const balancePayload = { uid: user.id };
            
            res = await this.http(balanceUrl, balanceHeaders, JSON.stringify(balancePayload));
            if (res.status === 200) {
                const balance = res.data.data;
                console.log(`Balance: ${balance / 1000}`);
            } else {
                console.error('Failed to get balance');
            }

            return token;
        } catch (error) {
            console.error('Login error:', error.message);
            return null;
        }
    }

    async claimNFT(token, walletAddress) {
        try {
            const claimUrl = "https://tgapp-api.matchain.io/api/tgapp/v1/wallet/claim/pioneer/nft";
            const headers = { ...this.headers, authorization: token };
            const payload = {
                address: this.cleanString(walletAddress),
                nft_address: "0xD51B8d58D73c5d46456d45DF9aF31E84ef550d1A"
            };

            const res = await this.http(claimUrl, headers, payload);
            
            const cleanData = {};
            for (const [key, value] of Object.entries(res.data.data)) {
                cleanData[key] = typeof value === 'string' ? this.cleanString(value) : value;
            }
            
            return cleanData;
        } catch (error) {
            console.error('Claim NFT error:', error.message);
            throw error;
        }
    }

    async mintNFT(privateKey, claimData) {
        try {
            const cleanPrivateKey = this.cleanString(privateKey);
            
            const wallet = new ethers.Wallet(cleanPrivateKey, this.provider);
            const contract = new ethers.Contract(
                this.nftContractAddress,
                this.nftContractABI,
                wallet
            );

            const cleanClaimData = {
                nft: this.cleanString(claimData.nft),
                deadline: claimData.deadline,
                verifier: this.cleanString(claimData.verifier),
                signature: this.cleanString(claimData.signature)
            };

            console.log('Clean signature:', cleanClaimData.signature);

            const tx = await contract.mintWithVerifierSignature(
                cleanClaimData.nft,
                cleanClaimData.deadline,
                cleanClaimData.verifier,
                cleanClaimData.signature
            );

            return await tx.wait();
        } catch (error) {
            console.error('Mint error details:', error);
            throw error;
        }
    }

    async processAccount(loginData, walletAddress, privateKey, proxy) {
        try {
            this.currentProxy = proxy;
            let proxyIP = "Unknown";
            
            try {
                proxyIP = await this.checkProxyIP(proxy);
            } catch (error) {
                console.error(`Failed to check proxy IP: ${error.message}`);
                // Continue with unknown IP
            }
            
            const cleanWallet = this.cleanString(walletAddress);
            console.log(`Processing account with wallet: ${cleanWallet} using proxy IP: ${proxyIP}`);
            
            const token = await this.login(loginData);
            if (!token) {
                console.error('Login failed');
                return;
            }

            const claimData = await this.claimNFT(token, cleanWallet);
            console.log('Claim data received');

            const receipt = await this.mintNFT(privateKey, claimData);
            console.log(`NFT minted successfully. Transaction hash: ${receipt.hash}`);

        } catch (error) {
            console.error(`Error processing account: ${error.message}`);
        } finally {
            this.currentProxy = null;
        }
    }

    async main() {
        const loginData = this.readAndCleanFile('data.txt');
        const walletAddresses = this.readAndCleanFile('wallet.txt');
        const privateKeys = this.readAndCleanFile('keywallet.txt');
        const proxies = this.readAndCleanFile('proxy.txt');

        console.log(`Found ${loginData.length} accounts to process`);

        for (let i = 0; i < loginData.length; i++) {
            console.log(`\nProcessing account ${i + 1}/${loginData.length}`);
            await this.processAccount(loginData[i], walletAddresses[i], privateKeys[i], proxies[i]);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

if (require.main === module) {
    const claimer = new MatChainNFTClaimer();
    claimer.main().catch(console.error);
}