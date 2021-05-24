# development environment
## Start Acala Node
### Docker
    docker run -p 9944:9944 acala/acala-node:latest --name "calling_home_from_a_docker_container" --rpc-external --ws-external --rpc-cors=all --dev
### Types
    polkadot js types:
        https://github.com/AcalaNetwork/acala.js/blob/master/packages/type-definitions/src/json/types.json

### Evm ui
    https://evm.acala.network/#/upload


### Waffle
    There are multiple tools you can use to develop and compile Solidity contracts.
    We use 'Waffle'.
    
    Tutorials:
    https://wiki.acala.network/build/development-guide/smart-contracts/get-started-evm/use-waffle

