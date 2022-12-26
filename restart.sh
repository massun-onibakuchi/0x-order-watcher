#!/bin/bash


# kill previous process
sudo supervisorctl stop 0x-orderwatcher
sudo supervisorctl stop 0x-api

# stop 8008
lsof -t -i:8008 | xargs kill
lsof -t -i:3000 | xargs kill

# stop docker
sudo docker stop 0x-api_postgres_1

# remove previouse db
sudo rm -rf /home/ubuntu/amaterasu/orderbook/0x-api/postgres

# build
yarn build

# start docer 
sudo docker start 0x-api_postgres_1

# start services
sudo supervisorctl start 0x-api
sudo supervisorctl start 0x-orderwatcher
