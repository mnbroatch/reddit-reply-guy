const Post = require('./post')

module.exports = class Data {
  constructor() {
    [
      'getAllPosts',
      'setPost',
      'getPost',
    ].forEach((functionName) => {
      this[functionName] = this[functionName].bind(this)
    })

    this.posts = {}
  }

  setPost(post) {
    if (!post) {
      console.log('post missing!')
    }
    this.posts[post.id] = new Post(post)
  }

  getPost(id) {
    return this.posts[id]
  }

  getAllPosts() {
    return Object.values(this.posts)
  }
}
