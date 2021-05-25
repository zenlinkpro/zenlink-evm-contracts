# development environment
## Start 

### Node
    git clone https://github.com/AcalaNetwork/Acala.git
    cargo run --features with-mandala-runtime --features with-ethereum-compatibility -- --dev -lruntime=debug -levm=debug 
    polkadot js types: ./acala-polkadot-js-type.json

### Evm ui
    https://evm.acala.network/#/upload


### Waffle
    There are multiple tools you can use to develop and compile Solidity contracts.
    We use 'Waffle'.
    
    Tutorials:
    https://wiki.acala.network/build/development-guide/smart-contracts/get-started-evm/use-waffle

## Test
    yarn install

