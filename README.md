# development environment
## Start 

### Node
    git clone https://github.com/AcalaNetwork/Acala.git
    cargo run --features with-mandala-runtime --features with-ethereum-compatibility -- --dev -lruntime=debug -levm=debug 
    polkadot js types: ./acala-polkadot-js-type.json

### Evm ui
    https://evm.acala.network/#/upload


## Build
    yarn
    yarn build

## Test
    yarn test

