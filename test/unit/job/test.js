const JobQueue = require('../../../lib/job')
const assert = require('assert')

/* eslint no-undef: 0 */

describe('JobQueue', () => {
  describe('create()', () => {
    it('should create a job', async () => {
      const queue = new JobQueue()
      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      assert.strictEqual(job.data.op, 'scaleUp')
    })

    it('should collapse duplicate jobs into one', async () => {
      const queue = new JobQueue()
      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      const job2 = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      assert.strictEqual(job.id, job2.id)
      console.log(job.updated_at.getTime(), job2.updated_at.getTime())
      assert.strictEqual(job.updated_at.valueOf() < job2.updated_at.valueOf(), true)
    })
  })

  describe('exists()', () => {
    it('should find a job with the same data', async () => {
      const queue = new JobQueue()
      const data = {
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }

      const job = await queue.create(data)

      const exists = await queue.exists(data)

      assert.strictEqual(exists, job.id)
    })

    it('should not find a job when using incorrect data', async () => {
      const queue = new JobQueue()
      const data = {
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }

      await queue.create(data)
      const exists = await queue.exists({})

      assert.strictEqual(exists, -1)
    })
  })

  describe('startWatcher()', () => {
    it('should transition a job from pending to ready', async () => {
      const queue = new JobQueue()
      queue.startWatcher()

      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }, 0.01)

      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          queue.stop()

          const jobs = await queue.ready()
          try {
            assert.strictEqual(jobs.length, 1)
            assert.strictEqual(jobs[0].id, job.id)
          } catch (err) {
            return reject(err)
          }

          return resolve()
        }, 1400)
      })
    })

    it('should not expire a job that is being updated', async () => {
      const queue = new JobQueue()
      queue.startWatcher()

      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      }, 0.01, 0.7)

      const updateInterval = setInterval(() => {
        queue.create({
          op: 'scaleUp',
          watcher: 'regular:all:all'
        })
      }, 500)

      return new Promise((resolve, reject) => {
        setTimeout(async () => {
          clearInterval(updateInterval)
          queue.stop()

          const jobs = await queue.ready()
          try {
            assert.strictEqual(jobs.length, 1)
            assert.strictEqual(jobs[0].id, job.id)
          } catch (err) {
            return reject(err)
          }

          return resolve()
        }, 1400)
      })
    })
  })

  describe('delete()', () => {
    it('should delete jobs correctly', async () => {
      const queue = new JobQueue()
      const job = await queue.create({
        op: 'scaleUp',
        watcher: 'regular:all:all'
      })

      const deletedJob = await queue.delete(job.id)
      assert.strictEqual(deletedJob.id, job.id)
    })
  })
})
