const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const { Op } = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {
        id,
        [Op.or]: [{ContractorId: req.profile.id}, {ClientId: req.profile.id}],
    }})
    if(!contract) return res.status(404).end()
    res.json(contract)
})

/**
 * @returns all active contracts of profile
 */
app.get('/contracts',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const contracts = await Contract.findAll({where: {
        status: {[Op.not]: 'terminated'},
        [Op.or]: [{ContractorId: req.profile.id}, {ClientId: req.profile.id}],
    }})
    res.json(contracts)
})

/**
 * @returns all unpaid jobs of profile
 */
app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Contract,Job} = req.app.get('models')
    const jobs = await Job.findAll({
        include: {
            model: Contract,
            where: {
                status: 'in_progress', // todo verify if "active contracts" have status "in_progress"
                [Op.or]: [{ContractorId: req.profile.id}, {ClientId: req.profile.id}],
            },
        },
        where: {
            ContractId: sequelize.col('Contract.id'),
            paid: null,
        }
    })
    res.json(jobs)
})
module.exports = app;
