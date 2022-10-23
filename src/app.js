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

/**
 * Pays a job as a client
 */
app.post('/jobs/:job_id/pay',getProfile ,async (req, res) =>{
    const {Profile,Contract,Job} = req.app.get('models')
    const contract = await Contract.findOne({
        include: {
            model: Job,
            where: {
                id: req.params.job_id,
            },
        },
        where: {
            // todo bug: this reference throws an exception "SQLITE_ERROR: no such column: Job.ContractId"
            id: sequelize.col('Job.ContractId'),
            status: {[Op.not]: 'terminated'},
            ClientId: req.profile.id,
        },
    })
    if (!contract) return res.status(404).end()
    // todo maybe merge subsequent Profile queries
    const [client, contractor] = await Promise.all([
        Profile.findOne({where: {
            id: contract.ClientId,
        }}),
        Profile.findOne({where: {
            id: contract.ContractorId,
        }}),
    ])
    if (contract.Job.paid) return res.status(200).end()
    if (contract.Job.price > client.balance) return res.status(402).end()
    await sequelize.transaction(async (transaction) => {
        return Promise.all([
            await Profile.increment({ balance: job.price * -1 }, { where: { id: client.id } }, transaction),
            await Profile.increment({ balance: job.price }, { where: { id: contractor.id } }, transaction),
            await Job.update({ paid: true, paymentDate: Date.now() }, { where: { id: contract.Job.id } }, transaction),
        ])
    })
    res.status(200).end()
})

/**
 * Deposits money into the account of a client
 */
app.post('/balances/deposit/:userId' ,async (req, res) =>{
    const {Profile,Contract,Job} = req.app.get('models')
    // todo verify if this route should be admin-scoped, due to :userId being present
    const client = await Profile.findOne({where: {
        id: req.params.userId,
    }})
    if(!client) return res.status(404).end()
    const debt = await Job.findOne({
        attributes: [
            [sequelize.fn('sum', sequelize.col('price')), 'total'],
        ],
        include: {
            model: Contract,
            where: {
                status: {[Op.not]: 'terminated'},
                ClientId: client.id,
            },
        },
        where: {
            ContractId: sequelize.col('Contract.id'),
            paid: null,
        },
    })
    if (req.body.amount > debt.get('total') * 1.25) return res.status(400).end()
    await Profile.increment({ balance: req.body.amount }, { where: { id: client.id } })
    res.status(200).end()
})

/**
 * @returns the profession that earned the most money
 */
app.get('/admin/best-profession', async (req, res) =>{
    const {Contract, Job, Profile} = req.app.get('models')
    const professionEarnings = await Profile.findAll({
        attributes: [
            'profession',
            // todo bug: this reference throws an exception "SQLITE_ERROR: no such column: Job.price"
            [sequelize.fn('sum', sequelize.col('Job.price')), 'total_amount_earned'],
        ],
        order: sequelize.col('total_amount_earned'),
        include: {
            model: Contract,
            include: {
                model: Job,
                where: {
                    paymentDate: {
                        [Op.gt]: req.query.start,
                        [Op.lt]: req.query.end,
                    },
                },
            },
            as: 'Contractor',
            where: {
                id: sequelize.col('Job.ContractId'),
            },
        },
        where: {
            id: sequelize.col('Contractor.ContractorId'),
        },
    })
    res.json(professionEarnings[0])
})

/**
 * @returns the clients that paid the most for jobs in the query time period
 */
app.get('/admin/best-clients', async (req, res) =>{
    const {Contract, Job, Profile} = req.app.get('models')
    const clients = await Profile.findAll({
        attributes: [
            'id',
            'fullName',
            // todo bug: this reference throws an exception "SQLITE_ERROR: no such column: Job.price"
            [sequelize.fn('sum', sequelize.col('Job.price')), 'paid'],
        ],
        order: sequelize.col('paid'),
        include: {
            model: Contract,
            include: {
                model: Job,
                where: {
                    paymentDate: {
                        [Op.gt]: req.query.start,
                        [Op.lt]: req.query.end,
                    },
                },
            },
            as: 'Contractor',
            where: {
                id: sequelize.col('Job.ContractId'),
            },
        },
        where: {
            id: sequelize.col('Contract.ClientId'),
        },
        limit: req.query.limit || 2,
    })
    res.json(clients)
})
module.exports = app;
