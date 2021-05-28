# development environment
## Start 

### Node
#### Cmd
    git clone https://github.com/AcalaNetwork/Acala.git
    cargo run --features with-mandala-runtime --features with-ethereum-compatibility -- --dev -lruntime=debug -levm=debug 
#### Docker
    docker run -p 9944:9944 acala/acala-node:latest --name "calling_home_from_a_docker_container" --rpc-external --ws-external --rpc-cors=all --dev
#### Types
    polkadot js types: ./acala-polkadot-js-type.json

### Evm ui
    https://evm.acala.network/#/upload


## Build
    yarn
    yarn build

## Test
    yarn test

